// Shown by route `loading.tsx` files so a click paints the next page frame immediately.
export function RouteSkeleton({ variant = 'panel' }: { variant?: 'grid' | 'detail' | 'panel' }) {
  return (
    <div className={`route-skeleton route-skeleton-${variant}`} role="status" aria-live="polite">
      <span className="profile-sr-only">Đang tải trang…</span>
      <div className="route-skeleton-title">
        <i />
        <i />
      </div>
      {variant === 'grid' && (
        <div className="route-skeleton-grid">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="route-skeleton-card">
              <i />
              <i />
              <i />
            </div>
          ))}
        </div>
      )}
      {variant === 'detail' && (
        <div className="route-skeleton-detail">
          <i />
          <div>
            <i />
            <i />
            <i />
            <i />
          </div>
        </div>
      )}
      {variant === 'panel' && (
        <div className="route-skeleton-panel">
          <div className="route-skeleton-stats">
            {Array.from({ length: 4 }, (_, index) => (
              <i key={index} />
            ))}
          </div>
          <i />
          <i />
          <i />
        </div>
      )}
    </div>
  );
}
