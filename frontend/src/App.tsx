import { useEffect, useState } from "react";
import { api, setActiveRole } from "./api/client";
import { Layout, type NavTab } from "./components/Layout";
import { AuditTrailPage } from "./pages/AuditTrailPage";
import { DashboardPage } from "./pages/DashboardPage";
import { GeneralLedgerPage } from "./pages/GeneralLedgerPage";
import { MerchantsPage } from "./pages/MerchantsPage";
import { OvaMirrorPage } from "./pages/OvaMirrorPage";
import { ReconciliationPage } from "./pages/ReconciliationPage";
import { ReportsPage } from "./pages/ReportsPage";
import { SettlementsPage } from "./pages/SettlementsPage";
import { TransactionsPage } from "./pages/TransactionsPage";
import type { DashboardSummary, InternalRole } from "./types/ledger";

export function App() {
  const [activeTab, setActiveTab] = useState<NavTab>("dashboard");
  const [role, setRole] = useState<InternalRole>("FINANCE");
  const [refreshKey, setRefreshKey] = useState(0);
  const [seeding, setSeeding] = useState(false);
  const [hasSampleData, setHasSampleData] = useState(false);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);

  const bump = () => setRefreshKey((k) => k + 1);

  const handleRoleChange = (nextRole: InternalRole) => {
    setActiveRole(nextRole);
    setRole(nextRole);
    bump();
  };

  useEffect(() => {
    const fetchSummary = () => {
      api
        .getDashboardSummary()
        .then((s) => {
          setSummary(s);
          setHasSampleData(s.has_sample_data);
        })
        .catch(() => {});
    };

    fetchSummary();
    const timer = window.setInterval(fetchSummary, 15000);
    return () => window.clearInterval(timer);
  }, [refreshKey]);

  const handleSeed = async () => {
    setSeeding(true);
    try {
      await api.seedSampleData();
      setHasSampleData(true);
      bump();
    } finally {
      setSeeding(false);
    }
  };

  return (
    <Layout
      activeTab={activeTab}
      onTabChange={setActiveTab}
      role={role}
      onRoleChange={handleRoleChange}
      onSeedSample={handleSeed}
      seeding={seeding}
      hasSampleData={hasSampleData}
      summary={summary}
    >
      {activeTab === "dashboard" && <DashboardPage refreshKey={refreshKey} onNavigate={setActiveTab} />}
      {activeTab === "ledger" && <GeneralLedgerPage refreshKey={refreshKey} />}
      {activeTab === "ova" && <OvaMirrorPage refreshKey={refreshKey} />}
      {activeTab === "merchants" && <MerchantsPage refreshKey={refreshKey} onDataChanged={bump} />}
      {activeTab === "settlements" && <SettlementsPage refreshKey={refreshKey} onDataChanged={bump} />}
      {activeTab === "transactions" && <TransactionsPage refreshKey={refreshKey} onDataChanged={bump} />}
      {activeTab === "reconciliation" && <ReconciliationPage refreshKey={refreshKey} onDataChanged={bump} />}
      {activeTab === "reports" && <ReportsPage refreshKey={refreshKey} onDataChanged={bump} />}
      {activeTab === "audit" && <AuditTrailPage refreshKey={refreshKey} />}
    </Layout>
  );
}

export default App;
