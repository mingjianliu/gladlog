import { useEffect, useState } from "react";
import { bridge } from "../../bridge";

export interface SpellIconProps {
  icon?: string;
  label: string;
  size?: number;
}

// 同名 icon 只发一次 IPC(泳道一场几百 chip;bridge 侧有磁盘缓存,这层防
// round-trip 抖动)。Promise 缓存:并发请求共享同一 in-flight。
const iconMemo = new Map<string, Promise<string | null>>();
function getIconCached(icon: string): Promise<string | null> {
  const hit = iconMemo.get(icon);
  if (hit) return hit;
  const b = bridge();
  const p =
    b && b.icon ? b.icon.get(icon) : Promise.resolve<string | null>(null);
  iconMemo.set(icon, p);
  return p;
}

export function SpellIcon({ icon, label, size = 16 }: SpellIconProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!icon);

  const fallbackChar = label ? label.charAt(0).toUpperCase() : "";

  useEffect(() => {
    if (!icon) {
      setLoading(false);
      return;
    }
    setLoading(true);
    let active = true;
    getIconCached(icon)
      .then((url) => {
        if (active) {
          setDataUrl(url);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setDataUrl(null);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [icon]);

  const style = {
    width: size,
    height: size,
  };

  if (!icon) {
    return (
      <span className="rpt-spellicon-fallback" style={style}>
        {fallbackChar}
      </span>
    );
  }

  if (loading) {
    return (
      <span className="rpt-spellicon-fallback" style={style}>
        {fallbackChar}
      </span>
    );
  }

  if (dataUrl) {
    return (
      <img src={dataUrl} alt={label} className="rpt-spellicon" style={style} />
    );
  }

  return (
    <span className="rpt-spellicon-fallback" style={style}>
      {fallbackChar}
    </span>
  );
}
