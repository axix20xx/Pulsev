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
import { AdminSales, CustomerAwgDownloads, CustomerDetail, Customers, LoginPage, Monitoring, Overview, PublicSubscription, PulseProvider, Reports, Sales, Services, SettingsPage } from '@/pages/pulse-pages';

const queryClient = new QueryClient();

function Router() {
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
             <Route path="/admin-sales" component={AdminSales} />
            <Route path="/services" component={Services} />
            <Route path="/customers" component={Customers} />
            <Route path="/customers/:id">{() => <><CustomerDetail /><CustomerAwgDownloads /></>}</Route>
            <Route path="/reports" component={Reports} />
             <Route path="/monitoring" component={Monitoring} />
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
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
