import sys
import warnings
import spaces
import gradio as gr

warnings.filterwarnings("ignore", message=".*Invalid file descriptor.*")
_orig_unraisablehook = sys.unraisablehook
def _quiet_fd_errors(unraisable):
    if unraisable.exc_type is ValueError and "Invalid file descriptor" in str(unraisable.exc_value):
        return
    _orig_unraisablehook(unraisable)
sys.unraisablehook = _quiet_fd_errors
import numpy as np
from PIL import Image
import torch
from segment_anything import sam_model_registry, SamPredictor
import urllib.request
import os

from scipy.ndimage import binary_dilation

DILATE_PX = 1  # grow each new mask by this many pixels before claiming, to close seam/edge gaps

CHECKPOINT = "sam_vit_b_01ec64.pth"
if not os.path.exists(CHECKPOINT):
    urllib.request.urlretrieve(
        "https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth",
        CHECKPOINT
    )

sam = sam_model_registry["vit_b"](checkpoint=CHECKPOINT)
predictor = SamPredictor(sam)

@spaces.GPU
def get_mask(arr, x, y):
    sam.to("cuda")
    predictor.set_image(arr)
    masks, scores, _ = predictor.predict(
        point_coords=np.array([[x, y]]),
        point_labels=np.array([1]),
        multimask_output=True
    )
    best = masks[np.argmax(scores)]
    return best.astype(np.uint8) * 255

def coverage_preview(arr, claimed):
    # dim everything already claimed so unclaimed pixels (e.g. a missed
    # camera) stay bright and obvious
    dim = (arr * 0.35).astype(np.uint8)
    return Image.fromarray(np.where(claimed[..., None], dim, arr))

def recompose(image, layers):
    if image is None or not layers:
        return None
    arr = np.array(image.convert("RGB"))
    h, w = arr.shape[:2]
    canvas = np.zeros((h, w, 4), dtype=np.uint8)
    for l in layers:
        crop = np.array(l["crop"])
        x, y, cw, ch = l["x"], l["y"], l["w"], l["h"]
        region = canvas[y:y + ch, x:x + cw].astype(np.float32)
        alpha = (crop[..., 3:4] / 255.0).astype(np.float32)
        region[..., :3] = region[..., :3] * (1 - alpha) + crop[..., :3] * alpha
        region[..., 3:4] = np.maximum(region[..., 3:4], crop[..., 3:4])
        canvas[y:y + ch, x:x + cw] = region.astype(np.uint8)
    return Image.fromarray(canvas)

def on_select(image, evt: gr.SelectData, layers, claimed):
    x, y = evt.index[0], evt.index[1]
    arr = np.array(image.convert("RGB"))
    h, w = arr.shape[:2]
    if claimed is None:
        claimed = np.zeros((h, w), dtype=bool)
    raw_mask = get_mask(arr, x, y) > 0
    m = binary_dilation(raw_mask, iterations=DILATE_PX)
    m = m & ~claimed  # drop pixels an earlier layer already took

    ys, xs = np.where(m)
    if len(xs) == 0:
        return layers, [l["crop"] for l in layers], claimed, coverage_preview(arr, claimed), recompose(image, layers)

    x0, x1 = xs.min(), xs.max()
    y0, y1 = ys.min(), ys.max()

    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[..., :3] = arr
    rgba[..., 3] = (m * 255).astype(np.uint8)

    crop = rgba[y0:y1+1, x0:x1+1]
    layer = {
        "crop": Image.fromarray(crop),
        "x": int(x0), "y": int(y0),
        "w": int(x1 - x0 + 1), "h": int(y1 - y0 + 1)
    }

    layers = layers + [layer]
    claimed = claimed | m
    return layers, [l["crop"] for l in layers], claimed, coverage_preview(arr, claimed), recompose(image, layers)

def clear_layers():
    return [], [], None, None, None

def on_remove(image, layers, claimed, evt: gr.SelectData):
    x, y = evt.index[0], evt.index[1]
    arr = np.array(image.convert("RGB"))
    h, w = arr.shape[:2]
    if claimed is None:
        claimed = np.zeros((h, w), dtype=bool)

    hit_idx = None
    for i in range(len(layers) - 1, -1, -1):
        l = layers[i]
        lx, ly, lw, lh = l["x"], l["y"], l["w"], l["h"]
        if lx <= x < lx + lw and ly <= y < ly + lh:
            crop_arr = np.array(l["crop"])
            if crop_arr[y - ly, x - lx, 3] > 0:
                hit_idx = i
                break

    if hit_idx is None:
        return layers, [l["crop"] for l in layers], claimed, coverage_preview(arr, claimed), recompose(image, layers)

    removed = layers[hit_idx]
    rx, ry, rw, rh = removed["x"], removed["y"], removed["w"], removed["h"]
    removed_alpha = np.array(removed["crop"])[..., 3] > 0
    claimed = claimed.copy()
    claimed[ry:ry + rh, rx:rx + rw][removed_alpha] = False
    layers = layers[:hit_idx] + layers[hit_idx + 1:]
    return layers, [l["crop"] for l in layers], claimed, coverage_preview(arr, claimed), recompose(image, layers)

with gr.Blocks(title="Influx Segmentation") as demo:
    gr.Markdown("# Influx Segmentation")
    gr.Markdown("Click a part to extract it. Each layer is cropped + carries its x,y offset for recomposition.")

    layers_state = gr.State([])
    claimed_state = gr.State(None)

    with gr.Row():
        input_img = gr.Image(type="pil", label="Image (click a point)")
        coverage_img = gr.Image(label="Coverage — click a bright spot to add it", interactive=False)
        output_gallery = gr.Gallery(label="Extracted layers", columns=3)

    with gr.Row():
        clear_btn = gr.Button("Clear layers")
        recompose_btn = gr.Button("Recompose")

    recomposed_img = gr.Image(label="Recomposed (gaps = missing pieces)", interactive=False)

    input_img.select(
        fn=on_select,
        inputs=[input_img, layers_state, claimed_state],
        outputs=[layers_state, output_gallery, claimed_state, coverage_img, recomposed_img]
    )
    coverage_img.select(
        fn=on_select,
        inputs=[input_img, layers_state, claimed_state],
        outputs=[layers_state, output_gallery, claimed_state, coverage_img, recomposed_img]
    )
    recomposed_img.select(
        fn=on_remove,
        inputs=[input_img, layers_state, claimed_state],
        outputs=[layers_state, output_gallery, claimed_state, coverage_img, recomposed_img]
    )
    clear_btn.click(
        fn=clear_layers,
        outputs=[layers_state, output_gallery, claimed_state, coverage_img, recomposed_img]
    )
    recompose_btn.click(
        fn=recompose,
        inputs=[input_img, layers_state],
        outputs=[recomposed_img]
    )

demo.launch()
