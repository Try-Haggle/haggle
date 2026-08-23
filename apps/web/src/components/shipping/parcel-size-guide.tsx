function BoxDiagram() {
  return (
    <svg viewBox="0 0 280 168" role="img" className="h-auto w-full" aria-hidden="true">
      <polygon points="78,30 176,12 238,44 140,68" className="fill-action-primary/10" />
      <polygon points="78,30 140,68 140,124 78,86" className="fill-surface-raised" />
      <polygon points="140,68 238,44 238,100 140,124" className="fill-action-primary/15" />
      <polyline
        points="78,30 176,12 238,44 238,100 140,124 78,86 78,30"
        className="stroke-ink"
        fill="none"
        strokeWidth="1.75"
      />
      <line x1="140" y1="68" x2="78" y2="30" className="stroke-ink/40" strokeWidth="1" />
      <line x1="140" y1="68" x2="238" y2="44" className="stroke-ink/40" strokeWidth="1" />
      <line x1="140" y1="68" x2="140" y2="124" className="stroke-ink/40" strokeWidth="1" />

      <line
        x1="86"
        y1="138"
        x2="228"
        y2="112"
        className="stroke-action-primary"
        strokeWidth="1.5"
        markerEnd="url(#parcel-arrow)"
      />
      <text x="118" y="156" className="fill-ink-secondary" fontSize="12">
        Length · longest side
      </text>
      <line
        x1="250"
        y1="48"
        x2="250"
        y2="104"
        className="stroke-action-primary"
        strokeWidth="1.5"
        markerEnd="url(#parcel-arrow)"
      />
      <text x="256" y="80" className="fill-ink-secondary" fontSize="12">
        H
      </text>
      <line
        x1="64"
        y1="38"
        x2="18"
        y2="64"
        className="stroke-action-primary"
        strokeWidth="1.5"
        markerEnd="url(#parcel-arrow)"
      />
      <text x="4" y="82" className="fill-ink-secondary" fontSize="12">
        W
      </text>
      <defs>
        <marker
          id="parcel-arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" className="fill-action-primary" />
        </marker>
      </defs>
    </svg>
  );
}

function CloseEnoughDiagram() {
  return (
    <svg viewBox="0 0 280 168" role="img" className="h-auto w-full" aria-hidden="true">
      <rect
        x="16"
        y="16"
        width="72"
        height="56"
        rx="6"
        className="fill-none stroke-ink-muted"
        strokeDasharray="5 4"
        strokeWidth="1.75"
      />
      <rect
        x="24"
        y="26"
        width="56"
        height="40"
        rx="5"
        className="fill-action-primary/10 stroke-ink"
        strokeWidth="1.75"
      />
      <text x="100" y="38" className="fill-ink" fontSize="13" fontWeight="600">
        A bit off
      </text>
      <text x="100" y="56" className="fill-ink-secondary" fontSize="12">
        Usually no extra fee
      </text>

      <rect
        x="16"
        y="96"
        width="40"
        height="28"
        rx="5"
        className="fill-surface-raised stroke-ink"
        strokeWidth="1.5"
      />
      <rect
        x="64"
        y="86"
        width="72"
        height="48"
        rx="6"
        className="fill-none stroke-warning"
        strokeDasharray="5 4"
        strokeWidth="1.75"
      />
      <text x="148" y="108" className="fill-ink" fontSize="13" fontWeight="600">
        Much bigger
      </text>
      <text x="148" y="126" className="fill-ink-secondary" fontSize="12">
        Then a fee can appear
      </text>
    </svg>
  );
}

export function ParcelSizeGuideArt() {
  return (
    <figure className="rounded-xl border border-line bg-surface-sunken p-3 sm:p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold text-ink">What to enter</p>
          <BoxDiagram />
        </div>
        <div>
          <p className="text-xs font-semibold text-ink">Close enough is fine</p>
          <CloseEnoughDiagram />
        </div>
      </div>
      <figcaption className="mt-1 text-xs text-ink-muted">
        Guess the box you will actually ship. A couple of inches or a few ounces off is normal.
      </figcaption>
    </figure>
  );
}
