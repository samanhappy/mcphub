import React, { ReactNode } from 'react';

interface ContentProps {
  children: ReactNode;
}

const Content: React.FC<ContentProps> = ({ children }) => {
  return (
    <main className="flex-1 p-6 overflow-auto">
      <div className="max-w-5xl mx-auto">
        {children}
      </div>
    </main>
  );
};

export default Content;