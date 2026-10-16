import { type ReactNode } from 'react';
import { Route, Switch, useLocation } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { AdminShell as Shell } from '@/admin/shell';
import {
  ActionRequests,
  AdminSales,
  Connections,
  CustomerDetail,
  Customers,
  LoginPage,
  Monitoring,
  Overview,
  PointOfSale,
  PulseProvider,
  Reports,
  ResellerAccounting,
  Sales,
  Services,
  SettingsPage,
  usePulse,
} from '@/pages/pulse-pages';
import AwgUsagePage from '@/pages/awg-usage';
import AwgUsageLogPage from '@/pages/awg-usage-log';
import { InsightDetailPage, SmartCenter } from '@/pages/smart-center';
import { OperationsCenter } from '@/pages/operations-center';
import ProviderAccountAuditPage from '@/pages/provider-account-audit';
import {
  NotificationAnalyticsPage,
  NotificationSendPage,
  NotificationStatusPage,
} from '@/pages/notification-pages';
import NotFound from '@/pages/not-found';
import { StorefrontManagerPage } from '@/pages/storefront';
import TelegramControlPage from '@/pages/telegram-control';

function ProviderAccountAuditRoute() {
  const { session } = usePulse();
  return session?.role === 'master_admin' ? <ProviderAccountAuditPage /> : <NotFound />;
}

function AwgUsageLogRoute() {
  const { session } = usePulse();
  return session?.role === 'master_admin' ? <AwgUsageLogPage /> : <NotFound />;
}

function TelegramControlRoute() {
  const { session } = usePulse();
  return session?.role === 'master_admin' ? <TelegramControlPage /> : <NotFound />;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

export default function ManagementApp() {
  return (
    <RoutedErrorBoundary>
      <PulseProvider>
        <Shell>
          <Switch>
            <Route path="/" component={Overview} />
            <Route path="/login" component={LoginPage} />
            <Route path="/sales" component={Sales} />
            <Route path="/pos" component={PointOfSale} />
            <Route path="/storefront" component={StorefrontManagerPage} />
            <Route path="/admin-sales" component={AdminSales} />
            <Route path="/reseller-accounting" component={ResellerAccounting} />
            <Route path="/action-requests" component={ActionRequests} />
            <Route path="/services" component={Services} />
            <Route path="/awg-usage" component={AwgUsagePage} />
            <Route path="/awg-usage-log" component={AwgUsageLogRoute} />
            <Route path="/customers" component={Customers} />
            <Route path="/customers/:id" component={CustomerDetail} />
            <Route path="/reports" component={Reports} />
            <Route path="/monitoring" component={Monitoring} />
            <Route path="/connections" component={Connections} />
            <Route path="/operations" component={OperationsCenter} />
            <Route path="/provider-account-audit" component={ProviderAccountAuditRoute} />
            <Route path="/insights/:focus" component={InsightDetailPage} />
            <Route path="/insights" component={SmartCenter} />
            <Route path="/notification-status" component={NotificationStatusPage} />
            <Route path="/notification-send" component={NotificationSendPage} />
            <Route path="/notification-analytics" component={NotificationAnalyticsPage} />
            <Route path="/telegram" component={TelegramControlRoute} />
            <Route path="/settings" component={SettingsPage} />
            <Route component={NotFound} />
          </Switch>
        </Shell>
      </PulseProvider>
    </RoutedErrorBoundary>
  );
}
