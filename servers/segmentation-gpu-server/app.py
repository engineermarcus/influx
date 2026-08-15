import sys
import warnings
import os
import uuid
import io
import base64
import numpy as np
from PIL import Image
import torch
from segment_anything import sam_model_registry, SamPredictor
import urllib.request
from scipy.ndimage import binary_dilation
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

warnings.filterwarnings("ignore")

DILATE_PX = 1
CHECKPOINT = "sam_vit_b_01ec64.pth"

print("Checking SAM checkpoint...")
if not os.path.exists(CHECKPOINT):
    print("Downloading SAM ViT-B checkpoint (~375MB)...")
    urllib.request.urlretrieve(
        "https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth",
        CHECKPOINT
    )
    print("Download complete.")

device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"Loading SAM on {device}...")
sam = sam_model_registry["vit_b"](checkpoint=CHECKPOINT)
sam.to(device)
predictor = SamPredictor(sam)
print("SAM ready.")

# In-memory session store  { session_id: { image, layers, claimed } }
sessions = {}

SESSION_TTL = 3600

def evict_stale_sessions():
    now = __import__("time").time()
    dead = [sid for sid, s in sessions.items() if now - s.get("_last_used", now) > SESSION_TTL]
    for sid in dead:
        del sessions[sid]

app = Flask(__name__, static_folder="static")
CORS(app)


# ── helpers ──────────────────────────────────────────────────────────────────

def img_to_b64(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def b64_to_img(b64: str) -> Image.Image:
    if "," in b64:
        b64 = b64.split(",", 1)[1]
    return Image.open(io.BytesIO(base64.b64decode(b64)))


def run_sam(sess, arr: np.ndarray, x: int, y: int) -> np.ndarray:
    if sess.get("_encoded_id") != id(sess["image"]):
        predictor.set_image(arr)
        sess["_encoded_id"] = id(sess["image"])
    masks, scores, _ = predictor.predict(
        point_coords=np.array([[x, y]]),
        point_labels=np.array([1]),
        multimask_output=True,
    )
    best = masks[np.argmax(scores)]
    return best.astype(np.uint8) * 255


def coverage_preview(arr: np.ndarray, claimed: np.ndarray) -> Image.Image:
    dim = (arr * 0.35).astype(np.uint8)

    # unclaimed: amber tint wash, color signal on top of brightness so it
    # stays distinct from claimed even when source pixels are already bright
    tint = np.array([255, 176, 32], dtype=np.float32)
    hot = (arr.astype(np.float32) * 0.55 + tint * 0.45).astype(np.uint8)

    out = np.where(claimed[..., None], dim, hot)

    # thin dark boundary line on the unclaimed side of the edge
    boundary = binary_dilation(claimed, iterations=1) & ~claimed
    out[boundary] = [20, 20, 20]

    return Image.fromarray(out)


def do_recompose(image: Image.Image, layers: list) -> Image.Image | None:
    if not layers:
        return None
    arr = np.array(image.convert("RGB"))
    h, w = arr.shape[:2]
    canvas = np.zeros((h, w, 4), dtype=np.uint8)
    for l in layers:
        crop = np.array(l["crop"])
        x, y, cw, ch = l["x"], l["y"], l["w"], l["h"]
        region = canvas[y : y + ch, x : x + cw].astype(np.float32)
        alpha = (crop[..., 3:4] / 255.0).astype(np.float32)
        region[..., :3] = region[..., :3] * (1 - alpha) + crop[..., :3] * alpha
        region[..., 3:4] = np.maximum(region[..., 3:4], crop[..., 3:4])
        canvas[y : y + ch, x : x + cw] = region.astype(np.uint8)
    return Image.fromarray(canvas)


def session_response(sess: dict) -> dict:
    image, layers, claimed = sess["image"], sess["layers"], sess["claimed"]
    arr = np.array(image.convert("RGB"))
    h, w = arr.shape[:2]
    if claimed is None:
        claimed = np.zeros((h, w), dtype=bool)
    recomposed = do_recompose(image, layers)
    return {
        "gallery": [img_to_b64(l["crop"]) for l in layers],
        "layer_meta": [{"x": l["x"], "y": l["y"], "w": l["w"], "h": l["h"]} for l in layers],
        "coverage": img_to_b64(coverage_preview(arr, claimed)),
        "recomposed": img_to_b64(recomposed) if recomposed else None,
        "layer_count": len(layers),
        "can_undo": len(sess["history"]) > 0,
    }


def get_session(session_id: str):
    if not session_id or session_id not in sessions:
        return None
    sessions[session_id]["_last_used"] = __import__("time").time()
    return sessions[session_id]

def push_history(sess: dict):
    """Snapshot layers+claimed before a mutating op, so it can be undone."""
    layers_copy = [dict(l) for l in sess["layers"]]  # crops are PIL Images, shallow copy is fine (never mutated in place)
    claimed_copy = sess["claimed"].copy() if sess["claimed"] is not None else None
    sess["history"].append({"layers": layers_copy, "claimed": claimed_copy})
    if len(sess["history"]) > 20:  # cap history so memory doesn't grow unbounded
        sess["history"].pop(0)




# ── routes ────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/api/session", methods=["POST"])
def create_session():
    sid = str(uuid.uuid4())
    sessions[sid] = {"image": None, "layers": [], "claimed": None, "history": []}
    return jsonify({"session_id": sid})


@app.route("/api/upload", methods=["POST"])
def upload():
    evict_stale_sessions()
    data = request.json
    sess = get_session(data.get("session_id"))
    if sess is None:
        return jsonify({"error": "Invalid session"}), 400

    image = b64_to_img(data["image"])
    sess["image"] = image
    sess["history"] = []
    sess["layers"] = []
    sess["claimed"] = None

    arr = np.array(image.convert("RGB"))
    h, w = arr.shape[:2]
    claimed = np.zeros((h, w), dtype=bool)

    return jsonify({
        "status": "ok",
        "width": image.width,
        "height": image.height,
        "coverage": img_to_b64(coverage_preview(arr, claimed)),
    })


@app.route("/api/segment", methods=["POST"])
def segment():
    data = request.json
    sess = get_session(data.get("session_id"))
    if sess is None:
        return jsonify({"error": "Invalid session"}), 400
    if sess["image"] is None:
        return jsonify({"error": "No image uploaded"}), 400

    x, y = int(data["x"]), int(data["y"])
    image, layers, claimed = sess["image"], sess["layers"], sess["claimed"]
    arr = np.array(image.convert("RGB"))
    h, w = arr.shape[:2]

    if claimed is None:
        claimed = np.zeros((h, w), dtype=bool)

    push_history(sess)
    raw_mask = run_sam(sess, arr, x, y) > 0
    m = binary_dilation(raw_mask, iterations=DILATE_PX) & ~claimed

    ys, xs = np.where(m)
    if len(xs) == 0:
        sess["claimed"] = claimed
        return jsonify(session_response(sess))

    x0, x1, y0, y1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[..., :3] = arr
    rgba[..., 3] = (m * 255).astype(np.uint8)

    sess["layers"] = layers + [{
        "crop": Image.fromarray(rgba[y0 : y1 + 1, x0 : x1 + 1]),
        "x": x0, "y": y0,
        "w": x1 - x0 + 1, "h": y1 - y0 + 1,
    }]
    sess["claimed"] = claimed | m
    return jsonify(session_response(sess))


@app.route("/api/remove", methods=["POST"])
def remove():
    data = request.json
    sess = get_session(data.get("session_id"))
    if sess is None:
        return jsonify({"error": "Invalid session"}), 400
    if sess["image"] is None:
        return jsonify({"error": "No image uploaded"}), 400

    x, y = int(data["x"]), int(data["y"])
    layers, claimed = sess["layers"], sess["claimed"]
    arr = np.array(sess["image"].convert("RGB"))
    h, w = arr.shape[:2]
    if claimed is None:
        claimed = np.zeros((h, w), dtype=bool)

    push_history(sess)
    hit = None
    for i in range(len(layers) - 1, -1, -1):
        l = layers[i]
        lx, ly, lw, lh = l["x"], l["y"], l["w"], l["h"]
        if lx <= x < lx + lw and ly <= y < ly + lh:
            crop_arr = np.array(l["crop"])
            if crop_arr[y - ly, x - lx, 3] > 0:
                hit = i
                break

    if hit is not None:
        removed = layers[hit]
        rx, ry, rw, rh = removed["x"], removed["y"], removed["w"], removed["h"]
        mask = np.array(removed["crop"])[..., 3] > 0
        claimed = claimed.copy()
        claimed[ry : ry + rh, rx : rx + rw][mask] = False
        sess["layers"] = layers[:hit] + layers[hit + 1 :]
        sess["claimed"] = claimed

    return jsonify(session_response(sess))


@app.route("/api/clear", methods=["POST"])
def clear():
    data = request.json
    sess = get_session(data.get("session_id"))
    if sess is None:
        return jsonify({"error": "Invalid session"}), 400

    push_history(sess)
    sess["layers"] = []
    sess["claimed"] = None

    if sess["image"]:
        arr = np.array(sess["image"].convert("RGB"))
        h, w = arr.shape[:2]
        claimed = np.zeros((h, w), dtype=bool)
        return jsonify({
            "gallery": [], "layer_meta": [], "layer_count": 0,
            "coverage": img_to_b64(coverage_preview(arr, claimed)),
            "recomposed": None,
        })
    return jsonify({"gallery": [], "layer_meta": [], "layer_count": 0, "coverage": None, "recomposed": None})


@app.route("/api/recompose", methods=["POST"])
def recompose():
    data = request.json
    sess = get_session(data.get("session_id"))
    if sess is None:
        return jsonify({"error": "Invalid session"}), 400
    result = do_recompose(sess["image"], sess["layers"])
    return jsonify({"recomposed": img_to_b64(result) if result else None})



@app.route("/api/undo", methods=["POST"])
def undo():
    data = request.json
    sess = get_session(data.get("session_id"))
    if sess is None:
        return jsonify({"error": "Invalid session"}), 400
    if not sess["history"]:
        return jsonify({"error": "Nothing to undo"}), 400

    prev = sess["history"].pop()
    sess["layers"] = prev["layers"]
    sess["claimed"] = prev["claimed"]
    resp = session_response(sess)
    resp["can_undo"] = len(sess["history"]) > 0
    return jsonify(resp)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=7860, debug=False)