import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Library } from './pages/Library';
import { Planning } from './pages/Planning';
import { Recovery } from './pages/Recovery';
import { Settings } from './pages/Settings';
import { Stats } from './pages/Stats';
import { Workout } from './pages/Workout';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // L'état de récupération évolue lentement : refaire une requête à chaque
      // retour sur l'onglet n'apporterait rien et couperait le fil de la séance.
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30_000,
    },
  },
});

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'recuperation', element: <Recovery /> },
      { path: 'seance', element: <Workout /> },
      { path: 'seance/:sessionId', element: <Workout /> },
      { path: 'planning', element: <Planning /> },
      { path: 'exercices', element: <Library /> },
      { path: 'statistiques', element: <Stats /> },
      { path: 'reglages', element: <Settings /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
