import React, { useState } from 'react';

export function Spoiler({ children }) {
  const [opened, setOpened] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpened(prevOpened => !prevOpened)}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          margin: 0,
          color: '#0b57d0',
          textDecoration: 'underline',
          cursor: 'pointer',
          font: 'inherit',
        }}
      >
        Show hint
      </button>
      {opened ? <div style={{ marginTop: '0.5rem' }}>{children}</div> : null}
    </div>
  );
}
