import { ThemeToggle } from './theme-toggle';

export const Footer = () => {
   return (
      <footer className="w-full border-t flex items-center p-4">
         <div className="w-full flex justify-end px-4">
            <ThemeToggle />
         </div>
      </footer>
   );
};
