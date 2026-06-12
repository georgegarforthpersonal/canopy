/**
 * Hooks Index
 *
 * Central export for all custom hooks in the application
 */

export { useResponsive } from './useResponsive';
export { useMapFullscreen, MapResizeHandler, MapStopOnUnmount } from './useMapFullscreen';
export { useArrowKeyNavigation } from './useArrowKeyNavigation';
export { useCameraTrapWizard } from './useCameraTrapWizard';
export type { CameraTrapWizardState, ImageFile, Classification } from './useCameraTrapWizard';
