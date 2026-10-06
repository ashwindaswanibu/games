/** The app mark, also rendered into the PNG icons (so it uses inline styles, not Tailwind). */
export function BrandMark({ size }: { size: number }) {
  const cell = Math.round(size * 0.2);
  const gap = Math.round(size * 0.05);
  const colors = ["#7c5cff", "#f59e0b", "#10b981", "#f7f5f0"];
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#1c1a17",
        borderRadius: Math.round(size * 0.22),
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", width: cell * 2 + gap, gap }}>
        {colors.map((color) => (
          <div key={color} style={{ width: cell, height: cell, borderRadius: Math.round(cell * 0.25), background: color }} />
        ))}
      </div>
    </div>
  );
}
