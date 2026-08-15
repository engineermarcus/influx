'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Header } from '@/components/Header';
import { UploadZone } from '@/components/UploadZone';
import { FramePanel } from '@/components/FramePanel';
import { FullscreenFrame } from '@/components/FullscreenFrame';
import { ActionBar } from '@/components/ActionBar';
import { Gallery } from '@/components/Gallery';
import { TabBar } from '@/components/TabBar';
import { Toast } from '@/components/Toast';
import { api } from '@/lib/api';
import { downloadDataUrl } from '@/lib/coords';
import type { FrameKey } from '@/lib/types';
import { RigCanvas } from '@/components/RigCanvas';
import { RigLayerPicker } from '@/components/RigLayerPicker';
import type { LayerMeta } from '@/lib/rigTypes';

export default function Home() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [inputImage, setInputImage] = useState<string | null>(null); // full data URL
  const [coverageImage, setCoverageImage] = useState<string | null>(null); // base64
  const [recomposedImage, setRecomposedImage] = useState<string | null>(null); // base64
  const [gallery, setGallery] = useState<string[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [layerMeta, setLayerMeta] = useState<LayerMeta[]>([]);
  const [imageDims, setImageDims] = useState({ w: 0, h: 0 });
  const [mode, setMode] = useState<'main' | 'rig'>('main');
  const [selectedForRig, setSelectedForRig] = useState<Set<number>>(new Set());
  const prevGalleryLenRef = useRef(0);
  const [segmenting, setSegmenting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null); // null = idle, 0-100 = uploading
  const [activeTab, setActiveTab] = useState<FrameKey>('input');
  const [fullscreenFrame, setFullscreenFrame] = useState<Extract<FrameKey, 'input' | 'coverage'> | null>(null);

  const [toastMsg, setToastMsg] = useState('');
  const [toastErr, setToastErr] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback((msg: string, isErr = false, ms = 2800) => {
    setToastMsg(msg);
    setToastErr(isErr);
    setToastVisible(true);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastVisible(false), ms);
  }, []);

  const sessionInitRef = useRef(false);
  const initSession = useCallback(async () => {
    try {
      const d = await api.createSession();
      setSessionId(d.session_id);
    } catch {
      toast('Could not reach the backend. Is it running?', true, 5000);
    }
  }, [toast]);

  useEffect(() => {
    if (sessionInitRef.current) return;
    sessionInitRef.current = true;
    initSession();
  }, [initSession]);

  // Auto-include newly segmented layers in the rig subset by default, and
  // drop any selected indices that fall out of range after undo/clear —
  // without this, a shrunk gallery could leave stale indices selected.
  useEffect(() => {
    setSelectedForRig((prev) => {
      const next = new Set(prev);
      for (let i = prevGalleryLenRef.current; i < gallery.length; i++) next.add(i);
      for (const i of Array.from(next)) {
        if (i >= gallery.length) next.delete(i);
      }
      return next;
    });
    prevGalleryLenRef.current = gallery.length;
  }, [gallery.length]);

  const dataUrl = (b64?: string | null) => (b64 ? `data:image/png;base64,${b64}` : null);

  const handleFile = useCallback(
    async (file: File) => {
      if (!sessionId) return;
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const full = ev.target?.result as string;
        setUploadProgress(0);
        try {
          const d = await api.uploadWithProgress(sessionId, full, setUploadProgress);
          if (d.error) {
            toast(d.error, true);
            return;
          }
          setInputImage(full);
          setCoverageImage(d.coverage ?? null);
          setRecomposedImage(null);
          setGallery([]);
          setLayerMeta([]);
          setImageDims({ w: d.width ?? 0, h: d.height ?? 0 });
          setActiveTab('input');
          toast(`Image loaded · ${d.width}×${d.height}px`);
        } catch (err) {
          toast('Upload failed: ' + (err as Error).message, true);
        } finally {
          setUploadProgress(null);
        }
      };
      reader.readAsDataURL(file);
    },
    [sessionId, toast]
  );

  const applySegmentResult = useCallback((d: { coverage?: string; recomposed?: string | null; gallery?: string[]; can_undo?: boolean; layer_meta?: LayerMeta[] }) => {
    if (d.coverage) setCoverageImage(d.coverage);
    setRecomposedImage(d.recomposed ?? null);
    setGallery(d.gallery ?? []);
    setCanUndo(d.can_undo ?? false);
    setLayerMeta(d.layer_meta ?? []);
  }, []);

  const handleSegment = useCallback(
    async (x: number, y: number) => {
      if (!sessionId) return;
      setSegmenting(true);
      try {
        const d = await api.segment(sessionId, x, y);
        if (d.error) {
          toast(d.error, true);
          return;
        }
        applySegmentResult(d);
        toast(`Layer ${d.layer_count ?? gallery.length + 1} added`);
      } catch (err) {
        toast('Segment failed: ' + (err as Error).message, true);
      } finally {
        setSegmenting(false);
      }
    },
    [sessionId, applySegmentResult, toast, gallery.length]
  );

  // Direct commit — no preview/confirm round trip. Backend still validates
  // "empty" via segmentConfirm's own mask check (falls through to the same
  // session_response with no new layer), so an empty selection just no-ops
  // instead of adding a blank layer.
  const handleBoxSelect = useCallback(
    async (box: [number, number, number, number]) => {
      if (!sessionId) return;
      setSegmenting(true);
      try {
        const d = await api.segmentConfirm(sessionId, { box });
        if (d.error) {
          toast(d.error, true);
          return;
        }
        applySegmentResult(d);
        toast(`Layer ${d.layer_count ?? gallery.length + 1} added`);
      } catch (err) {
        toast('Segment failed: ' + (err as Error).message, true);
      } finally {
        setSegmenting(false);
      }
    },
    [sessionId, applySegmentResult, toast, gallery.length]
  );

  const handlePointSelect = useCallback(
    async (x: number, y: number) => {
      if (!sessionId) return;
      setSegmenting(true);
      try {
        const d = await api.segmentConfirm(sessionId, { x, y });
        if (d.error) {
          toast(d.error, true);
          return;
        }
        applySegmentResult(d);
        toast(`Layer ${d.layer_count ?? gallery.length + 1} added`);
      } catch (err) {
        toast('Segment failed: ' + (err as Error).message, true);
      } finally {
        setSegmenting(false);
      }
    },
    [sessionId, applySegmentResult, toast, gallery.length]
  );

  const handleRemove = useCallback(
    async (x: number, y: number) => {
      if (!sessionId) return;
      try {
        const d = await api.remove(sessionId, x, y);
        if (d.error) {
          toast(d.error, true);
          return;
        }
        applySegmentResult(d);
        toast('Layer removed');
      } catch (err) {
        toast('Remove failed: ' + (err as Error).message, true);
      }
    },
    [sessionId, applySegmentResult, toast]
  );

  const handleUndo = useCallback(async () => {
    if (!sessionId) return;
    const d = await api.undo(sessionId);
    if (d.error) {
      toast(d.error, true);
      return;
    }
    applySegmentResult(d);
    toast('Undone');
  }, [sessionId, applySegmentResult, toast]);

  const handleClear = useCallback(async () => {
    if (!sessionId) return;
    const d = await api.clear(sessionId);
    applySegmentResult(d);
    toast('All layers cleared');
  }, [sessionId, applySegmentResult, toast]);

  const handleRecompose = useCallback(async () => {
    if (!sessionId) return;
    const d = await api.recompose(sessionId);
    if (d.recomposed) {
      setRecomposedImage(d.recomposed);
      toast('Recomposed!');
    } else {
      toast('Nothing to recompose yet', true);
    }
  }, [sessionId, toast]);

  const handleDownload = useCallback(() => {
    if (!recomposedImage) return;
    downloadDataUrl(dataUrl(recomposedImage)!, `recomposed-${Date.now()}.png`);
    toast('Download started');
  }, [recomposedImage, toast]);

  const resetAll = useCallback(() => {
    setInputImage(null);
    setCoverageImage(null);
    setRecomposedImage(null);
    setGallery([]);
    setCanUndo(false);
    setLayerMeta([]);
    setMode('main');
    setActiveTab('input');
    setFullscreenFrame(null);
    initSession().then(() => toast('Ready for a new image'));
  }, [initSession, toast]);

  const toggleRigLayer = useCallback((i: number) => {
    setSelectedForRig((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }, []);

  const selectAllRigLayers = useCallback(() => {
    setSelectedForRig(new Set(gallery.map((_, i) => i)));
  }, [gallery]);

  const selectNoRigLayers = useCallback(() => {
    setSelectedForRig(new Set());
  }, []);

  const hasImage = !!inputImage;

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 w-full max-w-[1400px] mx-auto px-4 sm:px-7 py-5 sm:py-6">
        {!hasImage && <UploadZone onFile={handleFile} progress={uploadProgress} />}

        {hasImage && mode === 'main' && (
          <>
            <TabBar active={activeTab} onChange={setActiveTab} layerCount={gallery.length} />

            {/* Desktop: 3-panel grid. Mobile: single active tab. */}
            <div className="hidden sm:grid grid-cols-3 gap-3.5 mb-5">
              <FramePanel
                frameKey="input"
                src={inputImage}
                canFullscreen
                onExpand={() => setFullscreenFrame('input')}
              />
              <FramePanel
                frameKey="coverage"
                src={dataUrl(coverageImage)}
                canFullscreen
                onExpand={() => setFullscreenFrame('coverage')}
                onBoxSelect={handleBoxSelect}
                onPointSelect={handlePointSelect}
                cursorStyle="crosshair"
                busy={segmenting}
                busyLabel="Segmenting…"
              />
              <FramePanel
                frameKey="recomposed"
                src={dataUrl(recomposedImage)}
                busy={segmenting}
                busyLabel="Segmenting…"
                onClickPoint={handleRemove}
                cursorStyle="cell"
                onUndo={handleUndo}
                canUndo={canUndo}
              />
            </div>

            <div className="sm:hidden mb-5">
              {activeTab === 'input' && (
                <FramePanel
                  frameKey="input"
                  src={inputImage}
                  canFullscreen
                  onExpand={() => setFullscreenFrame('input')}
                />
              )}
              {activeTab === 'coverage' && (
                <FramePanel
                  frameKey="coverage"
                  src={dataUrl(coverageImage)}
                  canFullscreen
                  onExpand={() => setFullscreenFrame('coverage')}
                  onBoxSelect={handleBoxSelect}
                  cursorStyle="crosshair"
                  onPointSelect={handlePointSelect}
                busy={segmenting}
                busyLabel="Segmenting…"
                />
              )}
              {activeTab === 'recomposed' && (
                <FramePanel
                  frameKey="recomposed"
                  src={dataUrl(recomposedImage)}
                  busy={segmenting}
                  busyLabel="Segmenting…"
                  onClickPoint={handleRemove}
                  cursorStyle="cell"
                  onUndo={handleUndo}
                  canUndo={canUndo}
                />
              )}
            </div>

            <ActionBar
              layerCount={gallery.length}
              hasRecomposed={!!recomposedImage}
              onRecompose={handleRecompose}
              onDownload={handleDownload}
              onClear={handleClear}
              onReset={resetAll}
              showReset={hasImage}
            />

            {gallery.length > 0 && (
              <RigLayerPicker
                layers={gallery}
                selected={selectedForRig}
                onToggle={toggleRigLayer}
                onSelectAll={selectAllRigLayers}
                onSelectNone={selectNoRigLayers}
                onConfirm={() => setMode('rig')}
              />
            )}

            <Gallery layers={gallery} />
          </>
        )}

        {hasImage && mode === 'rig' && (
          <RigCanvas
            layers={gallery
              .map((image, i) => ({ image, meta: layerMeta[i] ?? { x: 0, y: 0, w: 0, h: 0 }, idx: i }))
              .filter((l) => selectedForRig.has(l.idx))
              .map(({ image, meta }) => ({ image, meta }))}
            imageDims={imageDims}
            referenceImage={recomposedImage}
            onExit={() => setMode('main')}
          />
        )}
      </main>

      {fullscreenFrame && (
        <FullscreenFrame
          frameKey={fullscreenFrame}
          src={fullscreenFrame === 'input' ? inputImage : dataUrl(coverageImage)}
          busy={segmenting}
          onBoxSelect={handleBoxSelect}
          onPointSelect={handlePointSelect}
          onExit={() => setFullscreenFrame(null)}
          hudSrc={dataUrl(recomposedImage)}
        />
      )}

      <Toast message={toastMsg} isError={toastErr} visible={toastVisible} />
    </div>
  );
}