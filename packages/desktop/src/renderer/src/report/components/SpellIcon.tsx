import { useIconDataUrl } from "./useIconDataUrl";

interface SpellIconProps {
  icon?: string;
  label: string;
  size?: number;
}

export function SpellIcon({ icon, label, size = 16 }: SpellIconProps) {
  const { dataUrl, loading } = useIconDataUrl(icon);

  const fallbackChar = label ? label.charAt(0).toUpperCase() : "";
  const style = {
    width: size,
    height: size,
  };

  if (icon && !loading && dataUrl) {
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
