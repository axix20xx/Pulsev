import { lazy, Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useLocation, Router as WouterRouter, Route, Switch } from 'wouter';

const queryClient = new QueryClient();
const ManagementApp = lazy(() => import('@/management-app'));
const PublicLanding = lazy(() => import('@/pages/root-landing'));
const MobileApp = lazy(() =>
  import('@/mobile/mobile-pages').then((module) => ({ default: module.MobileApp })),
);
const PublicSubscription = lazy(() =>
  import('@/pages/pulse-pages').then((module) => ({ default: module.PublicSubscription })),
);
const PublicStorefront = lazy(() =>
  import('@/pages/storefront').then((module) => ({ default: module.PublicStorefrontPage })),
);
const isMobileBuild = import.meta.env.BASE_URL.replace(/\/$/, '').endsWith('/mobile');
const isPublicLandingBuild = import.meta.env.BASE_URL === '/';

function RouteLoading() {
  return (
    <main
      role="status"
      aria-live="polite"
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        color: '#53666a',
        background: '#f7f7f2',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      در حال بارگذاری…
    </main>
  );
}

function Router() {
  const [location] = useLocation();
  const isSubscriptionPath =
    location === '/sub' ||
    location.startsWith('/sub/') ||
    location === '/mobile/sub' ||
    location.startsWith('/mobile/sub/');
  const isMobilePath = location === '/mobile' || location.startsWith('/mobile/');

  if (isSubscriptionPath) {
    return <Suspense fallback={<RouteLoading />}><PublicSubscription /></Suspense>;
  }
  if (location.startsWith('/store/')) {
    return <Suspense fallback={<RouteLoading />}><Switch><Route path="/store/:slug" component={PublicStorefront} /><Route component={() => <RouteLoading />} /></Switch></Suspense>;
  }
  if (isMobileBuild || isMobilePath) {
    return <Suspense fallback={<RouteLoading />}><MobileApp /></Suspense>;
  }
  if (isPublicLandingBuild) {
    return <Suspense fallback={<RouteLoading />}><PublicLanding /></Suspense>;
  }
  return <Suspense fallback={<RouteLoading />}><ManagementApp /></Suspense>;
}

function App() {
  const configuredBase = import.meta.env.BASE_URL.replace(/\/$/, '');
  const routerBase =
    configuredBase.endsWith('/mobile') ||
    configuredBase.endsWith('/panel-sub-assets')
      ? ''
      : configuredBase;
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={routerBase}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
