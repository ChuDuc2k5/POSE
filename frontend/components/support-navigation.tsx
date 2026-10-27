'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, CircleHelp, FileText, Headphones, MessageCircle } from 'lucide-react';
import { useHoverMenu } from './use-hover-menu';

const items = [
  {
    href: '/#tu-van',
    label: 'Tư vấn cùng TERAVA',
    description: 'Nhận gợi ý phù hợp với nhu cầu của bạn.',
    icon: Headphones,
  },
  {
    href: '/tro-ly-ai',
    label: 'Trợ lý AI',
    description: 'Tìm kiếm nhanh cùng trợ lý thông minh.',
    icon: MessageCircle,
  },
  { href: '/#tu-van', label: 'Liên hệ', description: 'Kết nối với đội ngũ TERAVA.', icon: CircleHelp },
  { href: '/terms', label: 'Điều khoản', description: 'Thông tin điều khoản sử dụng dịch vụ.', icon: FileText },
];

export function SupportNavigation({ onNavigate }: { onNavigate?: () => void }) {
  const { open, close, toggle, hover } = useHoverMenu();
  const pathname = usePathname();
  return (
    <div
      className="support-menu"
      aria-current={pathname === '/tro-ly-ai' || pathname === '/consultation' ? 'page' : undefined}
      {...hover}
    >
      <button type="button" className="support-menu-trigger" aria-expanded={open} aria-haspopup="true" onClick={toggle}>
        Hỗ trợ <ChevronDown size={15} aria-hidden="true" className={open ? 'is-open' : ''} />
      </button>
      {open && (
        <div className="support-menu-panel" role="menu">
          {items.map(({ href, label, description, icon: Icon }) => (
            <Link
              href={href}
              role="menuitem"
              key={label}
              onClick={() => {
                close();
                onNavigate?.();
              }}
            >
              <Icon size={18} aria-hidden="true" />
              <span>
                <strong>{label}</strong>
                <small>{description}</small>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
