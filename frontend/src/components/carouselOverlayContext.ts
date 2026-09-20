import { createContext } from 'react';

export const CarouselOverlayContext = createContext<{ host: HTMLDivElement | null; active: boolean } | null>(null);
