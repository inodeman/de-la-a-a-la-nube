import { useEffect, useRef } from "react";
import { DocumentaryStage } from "./stage";

type Props = {
  worldRef: React.RefObject<string>;
  localRef: React.RefObject<number>;
};

export function StageCanvas({ worldRef, localRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const stage = new DocumentaryStage(canvas);
    let raf = 0;
    const loop = () => {
      stage.frame(worldRef.current || "road", localRef.current || 0);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const parent = canvas.parentElement;
    const observer = new ResizeObserver(() => stage.resize());
    if (parent) observer.observe(parent);
    const onMove = (event: PointerEvent) => {
      const rect = (parent ?? canvas).getBoundingClientRect();
      if (rect.width < 1) return;
      stage.setPointer((event.clientX - rect.left) / rect.width * 2 - 1, (event.clientY - rect.top) / rect.height * 2 - 1);
    };
    parent?.addEventListener("pointermove", onMove);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      parent?.removeEventListener("pointermove", onMove);
      stage.dispose();
    };
  }, [localRef, worldRef]);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />;
}
