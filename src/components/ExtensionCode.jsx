import React from 'react';
import useIsBrowser from '@docusaurus/useIsBrowser';
import CodeBlock from '@theme/CodeBlock';

export const ExtensionCode = ({ title, children }) => {
  const isBrowser = useIsBrowser();
  const origin = isBrowser ? location.origin : 'https://docs.turbowarp.org';

  const codeContent =
    children && typeof children === 'object' && 'default' in children
      ? children.default
      : typeof children === 'string'
        ? children
        : String(children);

  return (
    <div>
      <CodeBlock
        language="js"
        showLineNumbers
        title={
          <div>
            {`${title}.js`}
            {' - '}
            <a
              target="_blank"
              rel="noopener noreferrer"
              href={
                title.startsWith('unsandboxed/')
                  ? `https://turbowarp.org/editor?extension=https://extensions.turbowarp.org/docs-examples/${title}.js`
                  : `https://turbowarp.org/editor?extension=${origin}/example-extensions/${title}.js`
              }
            >
              {'Try this extension'}
            </a>
          </div>
        }
      >
        {codeContent}
      </CodeBlock>
    </div>
  );
};
