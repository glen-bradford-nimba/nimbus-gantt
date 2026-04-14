/**
 * templates/index.ts — Public API barrel for the v10 template framework.
 * See docs/template-api-design.md §4 + §10.
 */

export {
  defineTemplate,
  registerTemplate,
  getTemplate,
  listTemplates,
  hasTemplate,
} from './registry';

export {
  resolveTemplate,
  inheritReact,
  inheritVanilla,
} from './resolver';

export { INITIAL_STATE, reduceAppState } from './state';
export { SLOT_TO_FEATURE, SLOT_ORDER, shouldRenderSlot } from './slots';
export { themeToCssVars, themeToScopedCss } from './css';
export { ensureTemplateCss, removeTemplateCss } from './stylesheet-loader';

export type * from './types';
