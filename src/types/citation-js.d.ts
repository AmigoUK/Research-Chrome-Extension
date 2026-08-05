/** Minimal ambient types for the untyped citation-js packages we use. */

declare module '@citation-js/core' {
  export class Cite {
    constructor(data: unknown);
    format(
      type: 'bibliography' | 'citation',
      options: {
        format?: string;
        template?: string;
        lang?: string;
        /** Which cited ids this call renders — defaults to every item registered on the engine. */
        entry?: string[];
        /** Clusters before this one, each a list of ids, for retroactive disambiguation. */
        citationsPre?: string[][];
        /** Clusters after this one — citeproc needs both sides to disambiguate correctly. */
        citationsPost?: string[][];
      },
    ): string;
  }
  export const plugins: {
    config: {
      get(name: string): unknown;
    };
  };
}

declare module '@citation-js/plugin-csl';
