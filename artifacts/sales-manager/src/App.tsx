import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';
import { Shell } from '@/components/pulse-shell';
 import { ActionRequests, AdminSales, Connections, CustomerDetail, Customers, LoginPage, Monitoring, Overview, PointOfSale, PublicSubscription, PulseProvider, Reports, ResellerAccounting, Sales, Services, SettingsPage } from '@/pages/pulse-pages';
 import { SmartCenter } from '@/pages/smart-center';
 import { OperationsCenter } from '@/pages/operations-center';
import { MobileApp } from '@/mobile/mobile-pages';
import { NotificationAnalyticsPage, NotificationSendPage, NotificationStatusPage } from '@/pages/notification-pages';
import '@/mobile/mobile.css';

const queryClient = new QueryClient();

function Router() {
  const [location] = useLocation();
  if (location === '/mobile' || location.startsWith('/mobile/')) return <MobileApp />;
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <PulseProvider>
        <Shell>
          <Switch>
            <Route path="/sub" component={PublicSubscription} />
            <Route path="/" component={Overview} />
             <Route path="/login" component={LoginPage} />
            <Route path="/sales" component={Sales} />
             <Route path="/pos" component={PointOfSale} />
             <Route path="/admin-sales" component={AdminSales} />
             <Route path="/reseller-accounting" component={ResellerAccounting} />
            <Route path="/action-requests" component={ActionRequests} />
            <Route path="/services" component={Services} />
            <Route path="/customers" component={Customers} />
            <Route path="/customers/:id" component={CustomerDetail} />
            <Route path="/reports" component={Reports} />
             <Route path="/monitoring" component={Monitoring} />
             <Route path="/connections" component={Connections} />
             <Route path="/operations" component={OperationsCenter} />
             <Route path="/insights" component={SmartCenter} />
             <Route path="/notification-status" component={NotificationStatusPage} />
             <Route path="/notification-send" component={NotificationSendPage} />
              <Route path="/notification-analytics" component={NotificationAnalyticsPage} />
            <Route path="/settings" component={SettingsPage} />
            <Route component={NotFound} />
          </Switch>
        </Shell>
      </PulseProvider>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  const configuredBase = import.meta.env.BASE_URL.replace(/\/$/, '');
  const routerBase = configuredBase.endsWith('/mobile') ? '' : configuredBase;
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
