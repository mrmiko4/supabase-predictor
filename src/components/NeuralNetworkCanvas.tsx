import { useEffect, useRef } from "react";

interface Props {
  active: boolean;
  width?: number;
  height?: number;
}

interface Node {
  x: number;
  y: number;
  layer: number;
  pulsePhase: number;
  pulseSpeed: number;
}

interface Connection {
  from: number;
  to: number;
  signal: number;
  speed: number;
  active: boolean;
  delay: number;
}

const NeuralNetworkCanvas = ({ active, width = 220, height = 70 }: Props) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const nodesRef = useRef<Node[]>([]);
  const connectionsRef = useRef<Connection[]>([]);
  const initRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Build network topology
    if (!initRef.current) {
      const layers = [3, 5, 6, 5, 3];
      const nodes: Node[] = [];
      const connections: Connection[] = [];

      layers.forEach((count, li) => {
        const lx = (li + 0.5) * (width / layers.length);
        for (let ni = 0; ni < count; ni++) {
          const ny = ((ni + 1) / (count + 1)) * height;
          nodes.push({
            x: lx,
            y: ny,
            layer: li,
            pulsePhase: Math.random() * Math.PI * 2,
            pulseSpeed: 1.5 + Math.random() * 2,
          });
        }
      });

      // Connect adjacent layers
      let offset = 0;
      for (let li = 0; li < layers.length - 1; li++) {
        const nextOffset = offset + layers[li];
        for (let a = offset; a < nextOffset; a++) {
          for (let b = nextOffset; b < nextOffset + layers[li + 1]; b++) {
            connections.push({
              from: a,
              to: b,
              signal: -1,
              speed: 0.008 + Math.random() * 0.012,
              active: false,
              delay: Math.random() * 200,
            });
          }
        }
        offset = nextOffset;
      }

      nodesRef.current = nodes;
      connectionsRef.current = connections;
      initRef.current = true;
    }

    const nodes = nodesRef.current;
    const connections = connectionsRef.current;
    let startTime = performance.now();

    const draw = (time: number) => {
      const elapsed = time - startTime;
      ctx.clearRect(0, 0, width, height);

      if (!active) {
        // Draw static dim network
        ctx.globalAlpha = 0.15;
        connections.forEach((c) => {
          const nf = nodes[c.from];
          const nt = nodes[c.to];
          ctx.beginPath();
          ctx.moveTo(nf.x, nf.y);
          ctx.lineTo(nt.x, nt.y);
          ctx.strokeStyle = "#3a5a7a";
          ctx.lineWidth = 0.5;
          ctx.stroke();
        });
        nodes.forEach((n) => {
          ctx.beginPath();
          ctx.arc(n.x, n.y, 2, 0, Math.PI * 2);
          ctx.fillStyle = "#4a7a9a";
          ctx.fill();
        });
        ctx.globalAlpha = 1;
        animRef.current = requestAnimationFrame(draw);
        return;
      }

      // Activate random connections
      connections.forEach((c) => {
        if (!c.active && elapsed > c.delay && Math.random() < 0.03) {
          c.active = true;
          c.signal = 0;
        }
        if (c.active) {
          c.signal += c.speed * 16;
          if (c.signal > 1) {
            c.active = false;
            c.signal = -1;
            c.delay = elapsed + Math.random() * 400;
          }
        }
      });

      // Draw connections
      connections.forEach((c) => {
        const nf = nodes[c.from];
        const nt = nodes[c.to];

        // Base line
        ctx.beginPath();
        ctx.moveTo(nf.x, nf.y);
        ctx.lineTo(nt.x, nt.y);
        ctx.strokeStyle = "rgba(0,180,255,0.08)";
        ctx.lineWidth = 0.5;
        ctx.stroke();

        // Signal traveling
        if (c.active && c.signal >= 0) {
          const sx = nf.x + (nt.x - nf.x) * c.signal;
          const sy = nf.y + (nt.y - nf.y) * c.signal;

          // Glowing line segment
          const grad = ctx.createLinearGradient(nf.x, nf.y, nt.x, nt.y);
          const t = c.signal;
          const spread = 0.15;
          grad.addColorStop(Math.max(0, t - spread), "transparent");
          grad.addColorStop(t, "rgba(0,220,255,0.7)");
          grad.addColorStop(Math.min(1, t + spread), "transparent");
          ctx.beginPath();
          ctx.moveTo(nf.x, nf.y);
          ctx.lineTo(nt.x, nt.y);
          ctx.strokeStyle = grad;
          ctx.lineWidth = 1.5;
          ctx.stroke();

          // Signal dot
          ctx.beginPath();
          ctx.arc(sx, sy, 2, 0, Math.PI * 2);
          ctx.fillStyle = "#00eeff";
          ctx.shadowColor = "#00eeff";
          ctx.shadowBlur = 6;
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      });

      // Draw nodes
      nodes.forEach((n) => {
        const pulse = Math.sin(elapsed * 0.003 * n.pulseSpeed + n.pulsePhase);
        const r = 2.5 + pulse * 0.8;
        const alpha = 0.5 + pulse * 0.3;

        // Glow
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0,200,255,${alpha * 0.15})`;
        ctx.fill();

        // Core
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        const coreColor = n.layer === 0
          ? `rgba(255,180,50,${alpha})`
          : n.layer === 4
          ? `rgba(110,240,160,${alpha})`
          : `rgba(0,200,255,${alpha})`;
        ctx.fillStyle = coreColor;
        ctx.fill();
      });

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [active, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        display: "block",
        margin: "0 auto",
        borderRadius: 12,
        opacity: active ? 1 : 0.4,
        transition: "opacity 0.3s",
      }}
    />
  );
};

export default NeuralNetworkCanvas;
