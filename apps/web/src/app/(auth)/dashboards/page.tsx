'use client';

import { useEffect, useState } from 'react';

interface Dashboard {
  id: string;
  name: string;
  description?: string;
}

export default function DashboardsPage() {
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/bi/dashboards')
      .then((r) => r.json() as Promise<Dashboard[]>)
      .then(setDashboards)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div data-testid="loading">Loading...</div>;
  if (dashboards.length === 0) {
    return <div data-testid="empty">No dashboards yet.</div>;
  }

  return (
    <div data-testid="dashboards-page" className="p-6">
      <h1 className="text-2xl font-semibold mb-4">BI Dashboards</h1>
      <ul data-testid="dashboard-list">
        {dashboards.map((d) => (
          <li key={d.id} className="border p-3 mb-2 rounded">
            <h2 className="font-medium">{d.name}</h2>
            {d.description && <p className="text-sm text-muted-foreground">{d.description}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
