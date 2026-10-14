import { notFound } from 'next/navigation';
import { PropertyDetailCard } from '@/components/real-estate/property-detail';
import { properties, propertyMap } from '@/lib/mock-properties';

export function generateStaticParams() {
  return properties.map((property) => ({ id: property.id }));
}

export default async function PropertyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const property = propertyMap[id];

  if (!property) {
    notFound();
  }

  return <PropertyDetailCard property={property} />;
}
