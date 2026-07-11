import { useEffect, useState } from "react";
import { bridge } from "../../bridge";

export interface SpellIconProps {
  icon: string;
  label: string;
  size?: number;
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
    const b = bridge();
    if (!b || !b.icon) {
      setDataUrl(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    let active = true;
    b.icon
      .get(icon)
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
      <img
        src={dataUrl}
        alt={label}
        className="rpt-spellicon"
        style={style}
      />
    );
  }

  return (
    <span className="rpt-spellicon-fallback" style={style}>
      {fallbackChar}
    </span>
  );
}
