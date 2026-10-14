import Link from 'next/link';
import { ArrowRight, Bath, BedDouble, Building2, CheckCircle2, Headphones, MapPin, ShieldCheck, Sparkles, TrendingUp } from 'lucide-react';
import { AIChatWidget } from '@/components/ai/ai-chat-widget';
import { properties } from '@/lib/mock-properties';

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(value);

export function RevolandHomePage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <main>
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.18),_transparent_42%),radial-gradient(circle_at_bottom_right,_rgba(59,130,246,0.16),_transparent_35%)]" />
          <div className="relative mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1.2fr_0.8fr] lg:px-8 lg:py-20">
            <div className="max-w-xl">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700">
                <Sparkles className="h-3.5 w-3.5" />
                AI-guided home buying
              </div>

              <h1 className="text-4xl font-black tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
                Find a home you love with an intelligent property advisor.
              </h1>

              <p className="mt-6 text-lg leading-8 text-slate-600">
                Revoland helps you discover premium residences, compare financing options, and get instant AI suggestions tailored to your budget and lifestyle.
              </p>

              <div className="mt-8 flex flex-wrap gap-4">
                <Link href="#featured" className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-3 font-medium text-white transition hover:bg-slate-800">
                  View listings
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link href="/chat" className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-3 font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50">
                  Talk to AI agent
                </Link>
              </div>

              <div className="mt-10 grid max-w-lg gap-6 sm:grid-cols-3">
                {[
                  ['2.4k+', 'buyers matched'],
                  ['96%', 'satisfaction'],
                  ['18 min', 'avg. response'],
                ].map(([value, label]) => (
                  <div key={label} className="rounded-2xl border border-slate-200 bg-white/75 p-4 backdrop-blur-sm">
                    <p className="text-2xl font-bold text-slate-950">{value}</p>
                    <p className="mt-1 text-sm text-slate-500">{label}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative">
              <div className="absolute -left-10 top-12 h-40 w-40 rounded-full bg-sky-200/60 blur-3xl" />
              <div className="absolute -bottom-8 right-2 h-44 w-44 rounded-full bg-indigo-200/60 blur-3xl" />

              <div className="relative overflow-hidden rounded-[32px] border border-slate-200 bg-white p-4 shadow-[0_30px_80px_rgba(15,23,42,0.12)]">
                <img
                  src="https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=1200&q=80"
                  alt="Luxury apartment interior"
                  className="h-[420px] w-full rounded-[24px] object-cover"
                />
                <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Featured property</p>
                      <h2 className="mt-2 text-xl font-semibold text-slate-900">Vinhomes Grand Park</h2>
                    </div>
                    <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">Available</span>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl bg-white p-3">
                      <p className="text-xs text-slate-500">Price</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">4.2 tỷ</p>
                    </div>
                    <div className="rounded-xl bg-white p-3">
                      <p className="text-xs text-slate-500">Area</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">83 m²</p>
                    </div>
                    <div className="rounded-xl bg-white p-3">
                      <p className="text-xs text-slate-500">Beds</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">3 bed</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="discover" className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="mb-8 flex items-end justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-sky-700">Smart discovery</p>
              <h2 className="mt-2 text-3xl font-bold text-slate-900">Popular places to live</h2>
            </div>
            <Link href="/chat" className="inline-flex items-center gap-2 text-sm font-medium text-slate-700 hover:text-slate-900">
              Ask the AI for help <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="grid gap-5 md:grid-cols-3">
            {[
              { name: 'District 7', tag: 'Waterfront living', note: 'High demand for family apartments', image: 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=900&q=80' },
              { name: 'Thủ Đức', tag: 'Urban growth', note: 'New launches with strong ROI', image: 'https://images.unsplash.com/photo-1460317442991-0ec209397118?auto=format&fit=crop&w=900&q=80' },
              { name: 'Quận 9', tag: 'Green community', note: 'Family-friendly mixed-use projects', image: 'https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=900&q=80' },
            ].map((location) => (
              <div key={location.name} className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
                <img src={location.image} alt={location.name} className="h-56 w-full object-cover" />
                <div className="p-5">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{location.tag}</p>
                  <h3 className="mt-3 text-xl font-semibold text-slate-900">{location.name}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{location.note}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section id="featured" className="bg-white py-14">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mb-8 flex items-end justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-sky-700">Featured homes</p>
                <h2 className="mt-2 text-3xl font-bold text-slate-900">Tailored for modern living</h2>
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
              {properties.map((property) => (
                <div key={property.id} className="overflow-hidden rounded-[28px] border border-slate-200 bg-slate-50 shadow-sm transition hover:-translate-y-1 hover:shadow-lg">
                  <img src={property.image} alt={property.title} className="h-60 w-full object-cover" />
                  <div className="p-5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="rounded-full bg-slate-900 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-white">{property.type}</span>
                      <span className="text-sm font-semibold text-slate-900">{formatCurrency(property.price)}</span>
                    </div>

                    <h3 className="mt-4 text-xl font-semibold text-slate-900">{property.title}</h3>
                    <div className="mt-2 flex items-center gap-2 text-sm text-slate-600">
                      <MapPin className="h-4 w-4 text-slate-400" />
                      {property.location}
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2 text-sm text-slate-600">
                      <div className="flex items-center gap-1.5 rounded-xl bg-white px-2 py-2">
                        <BedDouble className="h-3.5 w-3.5 text-slate-500" />
                        {property.bedrooms} bed
                      </div>
                      <div className="flex items-center gap-1.5 rounded-xl bg-white px-2 py-2">
                        <Bath className="h-3.5 w-3.5 text-slate-500" />
                        {property.bathrooms} bath
                      </div>
                      <div className="flex items-center gap-1.5 rounded-xl bg-white px-2 py-2">
                        <Building2 className="h-3.5 w-3.5 text-slate-500" />
                        {property.area} m²
                      </div>
                    </div>

                    <div className="mt-5 flex items-center justify-between gap-3">
                      <span className="text-xs text-slate-500">Broker: {property.broker}</span>
                      <Link href={`/bat-dong-san/${property.id}`} className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-800">
                        View details
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="why-us" className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <div className="mb-8 text-center">
            <p className="text-xs uppercase tracking-[0.28em] text-sky-700">Why choose Revoland</p>
            <h2 className="mt-2 text-3xl font-bold text-slate-900">A complete home buying experience</h2>
          </div>

          <div className="grid gap-6 md:grid-cols-4">
            {[
              { icon: TrendingUp, title: 'Market insights', description: 'Live neighborhood data and price trends to guide your search.' },
              { icon: ShieldCheck, title: 'Trusted advisors', description: 'Verified brokers and transparent documentation at every step.' },
              { icon: Sparkles, title: 'AI property match', description: 'Instant shortlist based on your goals, budget, and location.' },
              { icon: Headphones, title: 'Personal support', description: 'Human-led guidance with AI-powered follow-up assistance.' },
            ].map(({ icon: Icon, title, description }) => (
              <div key={title} className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-100 text-sky-700">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">{description}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-20 pt-4 sm:px-6 lg:px-8">
          <div className="rounded-[32px] border border-slate-200 bg-slate-900 px-6 py-8 text-white shadow-[0_30px_80px_rgba(15,23,42,0.2)] sm:px-10">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-sky-300">Ready to move</p>
                <h2 className="mt-2 text-3xl font-bold">Need help comparing properties?</h2>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link href="/chat" className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 font-medium text-slate-900 transition hover:bg-slate-100">
                  Talk to advisor
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link href="#featured" className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-800 px-5 py-3 font-medium text-white transition hover:border-slate-600 hover:bg-slate-800/80">
                  See all listings
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <AIChatWidget property={properties[0]} />
    </div>
  );
}
