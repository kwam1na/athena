import { Button } from '@/components/ui/button';
import Link from 'next/link';

export default function Page() {
   return (
      <div className="flex flex-col gap-4 justify-center items-center w-full h-screen">
         <p className="text-center">You lost my g?</p>
         <Link href={'/'}>
            <Button>Take me home</Button>
         </Link>
      </div>
   );
}
