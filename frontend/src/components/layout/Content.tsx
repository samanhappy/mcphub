import React, { ReactNode } from 'react';

interface ContentProps {
  children: ReactNode;
}

const Content: React.FC<ContentProps> = ({ children }) => {
  return (
    <main className="flex-1 overflow-auto" style={{ background: 'var(--hub-bg)' }}>
      <div className="px-8 pt-6 pb-16 max-w-[1280px]">{children}</div>
    </main>
  );
};

export default Content;
