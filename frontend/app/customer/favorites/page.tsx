import { requirePageSession } from '@/lib/auth-server';
import { CustomerFavorites } from '@/components/customer-favorites';
export const metadata={title:'Yêu thích của tôi | NexCall',robots:{index:false,follow:false}};
export default async function FavoritesPage(){const session=await requirePageSession('/customer/favorites',['User']);return <CustomerFavorites role={session.role}/>;}
