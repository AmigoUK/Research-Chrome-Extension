/** Minimal ambient types for the untyped citation-js packages we use. */

declare module '@citation-js/core' {
  export class Cite {
    constructor(data: unknown);
    format(
      type: 'bibliography' | 'citation',
      options: { format?: string; template?: string; lang?: string },
    ): string;
  }
  export const plugins: {
    config: {
      get(name: string): unknown;
    };
  };
}

declare module '@citation-js/plugin-csl';
