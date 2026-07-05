import { ThemeProvider, CssBaseline } from '@mui/material';
import {
  createBrowserRouter,
  RouterProvider,
  Navigate,
  Outlet,
  useRouteError,
} from 'react-router-dom';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs from 'dayjs';
import 'dayjs/locale/en-gb';
import { theme } from './theme';
import { Layout } from './components/layout/Layout';
import { AuthProvider } from './context/AuthContext';
import { RequireAuth } from './components/auth/RequireAuth';
import { LoginPage } from './pages/auth/LoginPage';
import { AcceptInvitePage } from './pages/auth/AcceptInvitePage';
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage';
import { ToastProvider } from './context/ToastContext';
import { SurveysPage } from './pages/SurveysPage';
import { SurveyDetailPage } from './pages/SurveyDetailPage';
import { NewSurveyPage } from './pages/NewSurveyPage';
import { DashboardsPage } from './pages/DashboardsPage';
import { AdminPage } from './pages/AdminPage';
import { NewCameraTrapSurveyPage } from './pages/NewCameraTrapSurveyPage';
import { NewAudioSurveyPage } from './pages/NewAudioSurveyPage';
import TeamsPage from './pages/teams/TeamsPage';
import TeamDetailPage from './pages/teams/TeamDetailPage';
import AllSurveysPage from './pages/teams/AllSurveysPage';

// Set dayjs to use UK locale globally (dd/mm/yyyy format)
dayjs.locale('en-gb');

/**
 * Data routers catch render errors themselves by default. Rethrow so errors
 * keep bubbling up to the Sentry.ErrorBoundary in main.tsx, as they did with
 * the declarative <BrowserRouter>.
 */
function BubbleRouteError(): never {
  throw useRouteError();
}


// Data router (createBrowserRouter) rather than declarative <BrowserRouter>
// so that useBlocker can intercept in-app navigation (unsaved-changes guard).
const router = createBrowserRouter([
  {
    errorElement: <BubbleRouteError />,
    element: (
      <AuthProvider>
        <ToastProvider>
          <Outlet />
        </ToastProvider>
      </AuthProvider>
    ),
    children: [
      // Auth pages: reachable anonymously, rendered without the app chrome
      { path: '/login', element: <LoginPage /> },
      { path: '/accept-invite', element: <AcceptInvitePage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
      { path: '/reset-password', element: <ResetPasswordPage /> },

      // Everything else requires a signed-in account
      {
        element: (
          <RequireAuth>
            <Layout>
              <Outlet />
            </Layout>
          </RequireAuth>
        ),
        children: [
          // Teams (beta) — grid, per-type team page, and full survey history
          { path: '/teams', element: <TeamsPage /> },
          { path: '/teams/:typeId', element: <TeamDetailPage /> },
          { path: '/teams/:typeId/all', element: <AllSurveysPage /> },

          // Dashboard page
          { path: '/dashboards', element: <DashboardsPage /> },

          // Admin page
          { path: '/admin', element: <AdminPage /> },

          // Main surveys list page
          { path: '/surveys', element: <SurveysPage /> },

          // New survey page
          { path: '/surveys/new', element: <NewSurveyPage /> },

          // Camera trap survey wizard
          { path: '/surveys/new/camera-trap', element: <NewCameraTrapSurveyPage /> },

          // Audio survey wizard
          { path: '/surveys/new/audio', element: <NewAudioSurveyPage /> },

          // Survey detail page
          { path: '/surveys/:id', element: <SurveyDetailPage /> },

          // Redirect root to surveys
          { path: '/', element: <Navigate to="/surveys" replace /> },

          // Unmatched routes render an empty layout (as with <Routes> before)
          { path: '*', element: null },
        ],
      },
    ],
  },
]);

function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="en-gb">
        <RouterProvider router={router} />
      </LocalizationProvider>
    </ThemeProvider>
  );
}

export default App;
