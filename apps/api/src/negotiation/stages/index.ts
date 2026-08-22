/**
 * stages/index.ts
 *
 * Re-exports all 6 stage functions for external agent interop.
 * Each stage is independently callable.
 */

export { assembleStageContext } from "./context.js";
export { decide } from "./decide.js";
export { persist, persistWithDb } from "./persist.js";
export { respond } from "./respond.js";
export { understand, understandFromStructured } from "./understand.js";
export { validateStage } from "./validate.js";
