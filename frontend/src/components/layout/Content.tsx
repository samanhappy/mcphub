import React, { ReactNode } from 'react';

interface ContentProps {
  children: ReactNode;
}

const Content: React.FC<ContentProps> = ({ children }) => {
  return (
    <main className="flex-1 overflow-auto" style={{ background: 'var(--hub-bg)' }}>
      <div className="mx-auto w-full max-w-[1680px] px-6 pt-6 pb-16 lg:px-8 xl:px-10">{children}</div>
    </main>
  );
};

export default Content;
