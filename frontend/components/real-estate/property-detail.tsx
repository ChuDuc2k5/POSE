import Link from 'next/link';
import { ArrowLeft, Bath, BedDouble, Building2, CheckCircle2, MapPin, ShieldCheck } from 'lucide-react';
import { AIChatWidget } from '@/components/ai/ai-chat-widget';
import type { PropertyRecord } from '@/lib/mock-properties';

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(value);

export function PropertyDetailCard({ property }: { property: PropertyRecord }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <Link href="/" className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-100">
          <ArrowLeft className="h-4 w-4" />
          Back to listings
        </Link>
      </div>

      <main className="mx-auto grid max-w-7xl gap-8 px-4 pb-20 sm:px-6 lg:grid-cols-[1.15fr_0.85fr] lg:px-8">
        <div>
          <div className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
            <img src={property.image} alt={property.title} className="h-[520px] w-full object-cover" />
          </div>

          <div className="mt-8 rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{property.code}</p>
                <h1 className="mt-2 text-3xl font-bold text-slate-900">{property.title}</h1>
              </div>
              <div className="rounded-full bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">{property.type}</div>
            </div>

            <div className="mt-4 flex items-center gap-2 text-slate-600">
              <MapPin className="h-4 w-4 text-slate-400" />
              {property.location}
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Price</p>
                <p className="mt-2 text-xl font-semibold text-slate-900">{formatCurrency(property.price)}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Area</p>
                <p className="mt-2 text-xl font-semibold text-slate-900">{property.area} m²</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Direction</p>
                <p className="mt-2 text-xl font-semibold text-slate-900">{property.direction}</p>
              </div>
            </div>

            <div className="mt-6">
              <h2 className="text-lg font-semibold text-slate-900">Overview</h2>
              <p className="mt-3 text-base leading-7 text-slate-600">{property.description}</p>
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="flex items-center gap-2 text-slate-900"><BedDouble className="h-4 w-4 text-slate-500" /> Bedrooms</div>
                <p className="mt-3 text-2xl font-bold">{property.bedrooms}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="flex items-center gap-2 text-slate-900"><Bath className="h-4 w-4 text-slate-500" /> Bathrooms</div>
                <p className="mt-3 text-2xl font-bold">{property.bathrooms}</p>
              </div>
            </div>

            <div className="mt-8">
              <h2 className="text-lg font-semibold text-slate-900">Amenities</h2>
              <div className="mt-4 flex flex-wrap gap-2">
                {property.amenities.map((amenity) => (
                  <span key={amenity} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700">{amenity}</span>
                ))}
              </div>
            </div>
          </div>
        </div>

        <aside className="space-y-6">
          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Broker</p>
            <h2 className="mt-3 text-2xl font-bold text-slate-900">{property.broker}</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">{property.furnishing}</p>

            <div className="mt-6 space-y-3">
              {[
                'Verified legal documentation',
                'Financing support available',
                'Flexible viewing schedule',
              ].map((item) => (
                <div key={item} className="flex items-center gap-2 text-sm text-slate-700">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  {item}
                </div>
              ))}
            </div>

            <div className="mt-6 rounded-2xl bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Estimated mortgage</p>
              <p className="mt-3 text-3xl font-black text-slate-900">~26.4M</p>
              <p className="mt-1 text-sm text-slate-500">per month for a 15-year fixed-term loan</p>
            </div>

            <div className="mt-6 grid gap-3">
              <button type="button" className="rounded-full bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800">
                Book a viewing
              </button>
              <button type="button" className="rounded-full border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50">
                Request pricing details
              </button>
            </div>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-100 text-sky-700">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">AI Agent</p>
                <h3 className="text-xl font-semibold text-slate-900">Property advisor</h3>
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-600">Ask about mortgage calculations, pricing comparisons, or similar homes in the same district.</p>
          </div>
        </aside>
      </main>
      <AIChatWidget property={property} />
    </div>
  );
}
