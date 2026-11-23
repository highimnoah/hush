import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";

import { api } from "../../lib/ipc";
import type { LevelsEvent } from "../../lib/types";
import { usePlayer } from "../../store/player";
import styles from "../../styles/fullscreen.module.css";

interface VisualizerProps {
  variant: "bars" | "wave";
  className?: string;
}

/**
 * Audio-reactive visualizer driven by `player://levels` events. Subscribes
 * directly (not through the player store) because levels arrive at ~25 Hz.
 */
export function Visualizer({ variant, className = "" }: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const targetRef = useRef(0);
  const status = usePlayer((state) => state.status);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void api.playerSetLevelsEnabled(true).catch(() => {});
    listen<LevelsEvent>("player://levels", (event) => {
      targetRef.current = Math.max(
        0,
        Math.min(1, Number(event.payload.peak) || 0),
      );
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      unlisten?.();
      void api.playerSetLevelsEnabled(false).catch(() => {});
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let frame = 0;
    let smoothed = 0;
    let width = 1;
    let height = 1;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      width = Math.max(1, Math.floor(rect.width));
      height = Math.max(1, Math.floor(rect.height));
      const pixelWidth = Math.max(1, Math.floor(width * dpr));
      const pixelHeight = Math.max(1, Math.floor(height * dpr));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const draw = (time: number) => {
      frame = requestAnimationFrame(draw);

      const playing = statusRef.current === "playing";
      const target = playing ? targetRef.current : 0.02;
      const factor = target > smoothed ? 0.35 : 0.055;
      smoothed += (target - smoothed) * factor;
      const energy = Math.max(0.015, smoothed);

      const computed = getComputedStyle(document.documentElement);
      const accent = computed.getPropertyValue("--accent").trim() || "#82aaff";
      context.clearRect(0, 0, width, height);

      if (variant === "wave") {
        context.strokeStyle = accent;
        context.lineWidth = 2;
        context.beginPath();
        const middle = height / 2;
        const amplitude = Math.min(
          height * 0.36,
          height * (0.06 + energy * 0.55),
        );
        const steps = 120;
        const t = time / 1000;
        for (let i = 0; i <= steps; i += 1) {
          const x = (i / steps) * width;
          const envelope = Math.sin((i / steps) * Math.PI);
          const y =
            middle +
            Math.sin(i * 0.12 + t * 2.1) *
              Math.sin(i * 0.045 - t * 1.3) *
              amplitude *
              envelope;
          if (i === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.stroke();
        return;
      }

      const count = Math.max(24, Math.min(96, Math.floor(width / 14)));
      const slot = width / count;
      const gap = Math.min(4, Math.max(1.5, slot * 0.36));
      const barWidth = Math.max(1, slot - gap);
      const middle = height / 2;
      context.fillStyle = accent;
      for (let i = 0; i < count; i += 1) {
        const phase = i * 0.8 + Math.sin(i * 0.27) * 2.4;
        const wobble = 0.62 + 0.38 * Math.sin(time / 420 + phase);
        const centerBias = 0.55 + 0.45 * Math.sin((i / (count - 1)) * Math.PI);
        const ratio = Math.max(
          0.03,
          Math.min(1, energy * wobble * centerBias * 1.9),
        );
        const barHeight = Math.max(2, ratio * (height * 0.86));
        const x = i * slot + gap / 2;
        context.globalAlpha = 0.5 + 0.5 * ratio;
        context.fillRect(x, middle - barHeight / 2, barWidth, barHeight);
      }
      context.globalAlpha = 1;
    };

    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [variant]);

  return (
    <canvas
      ref={canvasRef}
      className={`${styles.visualizerCanvas} ${className}`}
      aria-hidden="true"
    />
  );
}
