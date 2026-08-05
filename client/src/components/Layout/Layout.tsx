import { type ReactNode } from 'react';
import Header from './Header';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div>
      <Header />
      {children}
    </div>
  );
}
