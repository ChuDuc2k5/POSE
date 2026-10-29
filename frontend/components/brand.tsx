import Link from 'next/link';
import Image from 'next/image';
import styles from './brand.module.css';

type IconVariant = 'navy' | 'white' | 'lavender' | 'mark';

export function TeravaMark({ size = 40, variant = 'navy' }: { size?: number; variant?: IconVariant }) {
  return (
    <Image
      src={variant === 'mark' ? '/brand/terava-mark.svg' : `/brand/terava-icon-${variant}.svg`}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className={`${styles.mark} ${variant === 'mark' ? styles.standaloneMark : ''}`}
      unoptimized
    />
  );
}

export function Brand({
  light = true,
  href = '/',
  iconVariant = 'navy',
  compactOnMobile = false,
  className = '',
}: {
  light?: boolean;
  href?: string;
  iconVariant?: Exclude<IconVariant, 'mark'>;
  compactOnMobile?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`${styles.brand} ${light ? styles.onDark : ''} ${compactOnMobile ? styles.responsive : ''} ${className}`}
      aria-label="TERAVA Real Estate — Trang chủ"
    >
      <span className={styles.lockup}>
        {light ? (
          <>
            <TeravaMark size={48} variant={iconVariant} />
            <Image
              src="/brand/terava-wordmark.svg"
              alt=""
              aria-hidden="true"
              width={624}
              height={145}
              className={styles.lightWordmark}
              unoptimized
            />
          </>
        ) : (
          <Image
            src="/brand/terava-horizontal.svg"
            alt=""
            aria-hidden="true"
            width={420}
            height={110}
            className={styles.horizontal}
            unoptimized
          />
        )}
      </span>
      {compactOnMobile && (
        <span className={styles.compact}>
          <TeravaMark size={42} variant={light ? 'white' : 'navy'} />
        </span>
      )}
    </Link>
  );
}

export function CityIllustration({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`city ${compact ? 'city-compact' : ''}`} aria-hidden="true">
      <div className="city-sun" />
      <div className="city-cloud cloud-one" />
      <div className="city-cloud cloud-two" />
      <div className="city-ground" />
      <div className="city-building tower-one">
        {Array.from({ length: 18 }, (_, i) => (
          <i key={i} />
        ))}
      </div>
      <div className="city-building tower-two">
        {Array.from({ length: 24 }, (_, i) => (
          <i key={i} />
        ))}
      </div>
      <div className="city-building tower-three">
        {Array.from({ length: 12 }, (_, i) => (
          <i key={i} />
        ))}
      </div>
      <div className="city-tree tree-one" />
      <div className="city-tree tree-two" />
      <div className="city-path" />
    </div>
  );
}
