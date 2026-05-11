/* Small colored circle + glyph for each schedule category. */
export type Category =
  | "workout" | "deep_work" | "meal" | "study" | "review"
  | "meeting" | "routine" | "personal" | "general";

export const CATEGORIES: { id: Category; label: string; color: string }[] = [
  { id: "workout",   label: "Workout",     color: "#ff9c2a" },
  { id: "deep_work", label: "Deep Work",   color: "#4ad6ff" },
  { id: "meal",      label: "Meal / Break",color: "#22e8a0" },
  { id: "study",     label: "Study",       color: "#b794ff" },
  { id: "review",    label: "Review",      color: "#ffd24a" },
  { id: "meeting",   label: "Meeting",     color: "#5b8dff" },
  { id: "routine",   label: "Routine",     color: "#94a8c9" },
  { id: "personal",  label: "Personal",    color: "#ff7ab5" },
  { id: "general",   label: "General",     color: "#6b7c9a" },
];

export function categoryMeta(id: string) {
  return CATEGORIES.find(c => c.id === id) ?? CATEGORIES[CATEGORIES.length - 1];
}

function Glyph({ cat }: { cat: Category }) {
  switch (cat) {
    case "workout":
      // dumbbell
      return (
        <g stroke="white" strokeWidth="1.5" strokeLinecap="round" fill="none">
          <line x1="6" y1="12" x2="18" y2="12" />
          <rect x="3" y="9" width="3" height="6" rx="0.5" fill="white" />
          <rect x="18" y="9" width="3" height="6" rx="0.5" fill="white" />
        </g>
      );
    case "deep_work":
      // bolt
      return <path d="M13 3 L7 13 H11 L10 21 L17 10 H13 Z" fill="white" />;
    case "meal":
      // utensils
      return (
        <g stroke="white" strokeWidth="1.5" strokeLinecap="round" fill="none">
          <line x1="8" y1="3" x2="8" y2="21" />
          <path d="M5 3 v6 a3 3 0 0 0 6 0 V3" />
          <line x1="17" y1="3" x2="17" y2="21" />
          <path d="M17 3 c2 0 2 4 0 5" />
        </g>
      );
    case "study":
      // book
      return (
        <g stroke="white" strokeWidth="1.5" fill="none">
          <path d="M4 5 c3 -1 7 -1 8 1 c1 -2 5 -2 8 -1 v13 c-3 -1 -7 -1 -8 1 c-1 -2 -5 -2 -8 -1 z" />
          <line x1="12" y1="6" x2="12" y2="19" />
        </g>
      );
    case "review":
      // checklist
      return (
        <g stroke="white" strokeWidth="1.5" strokeLinecap="round" fill="none">
          <rect x="5" y="4" width="14" height="16" rx="2" />
          <path d="M8 9 l2 2 l4 -4" />
          <line x1="8" y1="15" x2="15" y2="15" />
        </g>
      );
    case "meeting":
      // video
      return (
        <g fill="white">
          <rect x="3" y="7" width="13" height="10" rx="2" />
          <polygon points="17,9 22,7 22,17 17,15" />
        </g>
      );
    case "routine":
      // moon / sun hybrid
      return <path d="M14 4 a8 8 0 1 0 6 11 a6 6 0 0 1 -6 -11 z" fill="white" />;
    case "personal":
      // heart
      return <path d="M12 21 C 4 14 4 6 9 6 C 11 6 12 8 12 8 C 12 8 13 6 15 6 C 20 6 20 14 12 21 Z" fill="white" />;
    default:
      // dot
      return <circle cx="12" cy="12" r="3" fill="white" />;
  }
}

export function CategoryIcon({ category, size = 36 }: { category: string; size?: number }) {
  const cat = (CATEGORIES.find(c => c.id === category) ? category : "general") as Category;
  const color = categoryMeta(cat).color;
  return (
    <span
      className="inline-flex items-center justify-center rounded-full shrink-0"
      style={{
        width: size, height: size,
        background: `radial-gradient(circle at 30% 30%, ${color}cc, ${color}88 60%, ${color}44 100%)`,
        boxShadow: `0 0 12px ${color}55, inset 0 1px 0 rgba(255,255,255,0.15)`,
        border: `1px solid ${color}aa`,
      }}>
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" aria-hidden>
        <Glyph cat={cat} />
      </svg>
    </span>
  );
}
