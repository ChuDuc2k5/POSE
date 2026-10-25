import Image from 'next/image';
import Link from 'next/link';
import { Clock3, ShieldCheck, Star } from 'lucide-react';
import { HomeConsultation, HomeNavigation, HomePropertySearch, FeaturedProperties } from './home-sections';
import styles from './system-home.module.css';
import { Brand } from './brand';
import type { Role } from '@/lib/roles';

const categories = [
  { type: 'Apartment', label: 'Căn hộ', image: 'apartment', alt: 'Căn hộ với phòng khách rộng, ngập ánh sáng tự nhiên' },
  { type: 'Villa', label: 'Biệt thự', image: 'villa', alt: 'Biệt thự sân vườn có hồ bơi riêng' },
  { type: 'Office', label: 'Văn phòng', image: 'office', alt: 'Tòa nhà văn phòng hiện đại tại trung tâm thành phố' },
];

const benefits = [
  { icon: ShieldCheck, title: 'Thông tin minh bạch', text: 'Tra cứu thông tin, hình ảnh và tình trạng bất động sản trong cùng một nơi.' },
  { icon: Star, title: 'Tư vấn chuyên nghiệp', text: 'Chia sẻ nhu cầu để đội ngũ tư vấn đồng hành cùng bạn trên hành trình tìm kiếm.' },
  { icon: Clock3, title: 'Chủ động kết nối', text: 'Gửi yêu cầu bất cứ lúc nào và theo dõi phản hồi trong tài khoản của bạn.' },
];

const priorities = [
  { quote: 'Một căn hộ đúng ngân sách, vị trí thuận tiện và một không gian thực sự thuộc về mình.', initial: 'N', name: 'Người mua nhà', detail: 'An cư & tận hưởng cuộc sống' },
  { quote: 'Thông tin rõ ràng, dễ so sánh để tự tin hơn trước mỗi quyết định đầu tư.', initial: 'Đ', name: 'Nhà đầu tư', detail: 'Tìm kiếm giá trị dài hạn' },
  { quote: 'Một địa điểm phù hợp để doanh nghiệp phát triển và tạo nên những kết nối mới.', initial: 'D', name: 'Khách hàng doanh nghiệp', detail: 'Không gian cho sự phát triển' },
];

export function SystemHome({ role, name }: { role: Role | null; name?: string }) {
  return <div className={styles.page} id="trang-chu">
    <HomeNavigation role={role} name={name}/>
    <main>
      <section className={styles.hero} aria-labelledby="home-heading">
        <div className={`${styles.container} ${styles.heroGrid}`}>
          <div className={styles.heroCopy}>
            <span className={styles.eyebrow}>THƯƠNG HIỆU BẤT ĐỘNG SẢN TERAVA</span>
            <h1 id="home-heading">Khám phá bất động sản cao cấp với TERAVA</h1>
            <p>Tìm nhà, chung cư, biệt thự và dự án phù hợp với bạn. Khám phá thông tin rõ ràng, kết nối tư vấn và đến gần hơn với không gian lý tưởng.</p>
            <div className={styles.actions}>
              <Link href="#tim-kiem" className={styles.primaryButton}>Tìm kiếm dự án</Link>
              <Link href="#tu-van" className={styles.secondaryButton}>Tư vấn miễn phí</Link>
            </div>
            <div className={styles.stats}>
              <div><strong>6 loại hình</strong><span>Bất động sản đa dạng</span></div>
              <div><strong>24/7</strong><span>Chủ động tìm kiếm</span></div>
              <div><strong>Một nơi</strong><span>Kết nối mọi nhu cầu</span></div>
            </div>
          </div>
          <div className={styles.heroGallery}>
            <Link href="#du-an" className={styles.heroImage} aria-label="Khám phá dự án nổi bật">
              <Image src="/images/home/hero.webp" alt="Tòa căn hộ cao cấp bên đường chân trời thành phố lúc hoàng hôn" width={1536} height={1024} sizes="(max-width: 760px) calc(100vw - 40px), (min-width: 1392px) 688px, 54vw" quality={90} preload/>
              <span className={styles.imageBadge}>Dự án nổi bật</span>
            </Link>
            <div className={styles.categoryGrid}>
              {categories.map(category => <Link href={`/properties?type=${category.type}`} key={category.type} className={styles.categoryImage}>
                <Image src={`/images/home/${category.image}.webp`} alt={category.alt} width={1536} height={1024} sizes="(max-width: 760px) 30vw, (min-width: 1392px) 219px, 18vw" quality={90}/>
                <span className={styles.imageBadge}>{category.label}</span>
              </Link>)}
            </div>
          </div>
        </div>
      </section>

      <section className={styles.discovery} aria-label="Khám phá bất động sản">
        <div className={styles.container}>
          <HomePropertySearch/>
          <section id="du-an" className={styles.featured} aria-labelledby="featured-heading">
            <div className={styles.sectionHeading}>
              <div><h2 id="featured-heading">Dự án nổi bật</h2><p>Khám phá những lựa chọn cho không gian sống và làm việc của bạn.</p></div>
              <Link href="/properties" className={styles.smallButton}>Xem tất cả dự án</Link>
            </div>
            <FeaturedProperties/>
          </section>
        </div>
      </section>

      <section className={styles.benefits} id="ve-nexcall" aria-labelledby="benefits-heading">
        <div className={`${styles.container} ${styles.benefitGrid}`}>
          <div className={styles.benefitIntro}>
            <h2 id="benefits-heading">Tại sao chọn TERAVA</h2>
            <p>Chúng tôi kết nối khách hàng với những cơ hội bất động sản phù hợp thông qua thông tin rõ ràng, tư vấn tận tâm và sự đồng hành trong hành trình tìm kiếm.</p>
            <Link href="#tu-van" className={styles.primaryButton}>Liên hệ tư vấn</Link>
          </div>
          {benefits.map(({ icon: Icon, title, text }) => <article className={styles.benefitCard} key={title}>
            <span className={styles.benefitIcon}><Icon size={21} strokeWidth={1.7}/></span>
            <h3>{title}</h3><p>{text}</p>
          </article>)}
        </div>
      </section>

      <section className={styles.priorities} id="dong-hanh" aria-labelledby="priorities-heading">
        <div className={styles.container}>
          <div className={styles.sectionHeading}><div><h2 id="priorities-heading">Mỗi nhu cầu, một hành trình riêng</h2><p>TERAVA đồng hành cùng những điều bạn đang tìm kiếm.</p></div></div>
          <div className={styles.priorityGrid}>{priorities.map(item => <article key={item.name} className={styles.priorityCard}>
            <p>“{item.quote}”</p>
            <div className={styles.person}><span>{item.initial}</span><div><strong>{item.name}</strong><small>{item.detail}</small></div></div>
          </article>)}</div>
        </div>
      </section>

      <section className={styles.consultation} id="tu-van" aria-labelledby="consultation-heading">
        <div className={`${styles.container} ${styles.consultationGrid}`}>
          <div className={styles.consultationCopy}>
            <h2 id="consultation-heading">Cần tư vấn dự án phù hợp?</h2>
            <p>TERAVA đồng hành cùng bạn tìm kiếm, so sánh và lựa chọn bất động sản theo nhu cầu thực tế.</p>
            <div className={styles.actions}><a href="#dang-ky-tu-van" className={styles.whiteButton}>Đăng ký tư vấn</a><Link href="/properties" className={styles.darkButton}>Khám phá bất động sản</Link></div>
          </div>
          <HomeConsultation/>
        </div>
      </section>
    </main>

    <footer className={styles.footer}>
      <div className={styles.container}>
        <div className={styles.footerGrid}>
          <div className={styles.footerAbout}><Brand light/><p>Kết nối bất động sản và khách hàng bằng thông tin rõ ràng, sự chuyên nghiệp và những lựa chọn phù hợp.</p></div>
          <div><h3>Dịch vụ</h3><Link href="/properties">Tìm bất động sản</Link><a href="#tu-van">Tư vấn nhu cầu</a><Link href="/properties?transaction=Rent">Bất động sản cho thuê</Link></div>
          <div><h3>Về TERAVA</h3><a href="#ve-nexcall">Về chúng tôi</a><a href="#du-an">Dự án nổi bật</a><a href="#dong-hanh">Đồng hành cùng bạn</a></div>
          <div><h3>Hỗ trợ</h3><a href="#tu-van">Liên hệ tư vấn</a><Link href="/sign-in">Đăng nhập</Link><Link href="/sign-up">Tạo tài khoản</Link></div>
        </div>
        <div className={styles.footerBottom}><span>© {new Date().getFullYear()} TERAVA. Tất cả quyền được bảo lưu.</span><Link href="/terms">Chính sách bảo mật & Điều khoản sử dụng</Link></div>
      </div>
    </footer>
  </div>;
}
