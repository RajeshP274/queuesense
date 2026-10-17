import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { Skeleton, ToastHost } from "./components/ui.jsx";
import Landing from "./pages/Landing.jsx";
import Join from "./pages/Join.jsx";
import Ticket from "./pages/Ticket.jsx";

// Staff, board, booking, admin, operator, create and help are code-split so customer pages stay light on 3G.
const Booking = lazy(() => import("./pages/Booking.jsx"));
const StaffLogin = lazy(() => import("./pages/StaffLogin.jsx"));
const StaffConsole = lazy(() => import("./pages/StaffConsole.jsx"));
const Board = lazy(() => import("./pages/Board.jsx"));
const Admin = lazy(() => import("./pages/Admin.jsx"));
const Help = lazy(() => import("./pages/Help.jsx"));
const Create = lazy(() => import("./pages/Create.jsx"));
const Created = lazy(() => import("./pages/Created.jsx"));
const Operator = lazy(() => import("./pages/Operator.jsx"));
const Guide = lazy(() => import("./pages/Guide.jsx"));
const Auth = lazy(() => import("./pages/Auth.jsx"));
const Account = lazy(() => import("./pages/Account.jsx"));
const Tour = lazy(() => import("./pages/Tour.jsx"));

function NotFound() {
  return (
    <div className="page narrow">
      <div className="card empty"><div className="ico">🧭</div><p>Page not found.</p><a className="btn" href="/">Home</a></div>
    </div>
  );
}

export default function App() {
  return (
    <>
      <Suspense fallback={<div className="page"><Skeleton h={120} n={3} /></div>}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/v/:slug" element={<Join />} />
          <Route path="/t/:code" element={<Ticket />} />
          <Route path="/b/:slug" element={<Booking />} />
          <Route path="/staff" element={<StaffLogin role="STAFF" />} />
          <Route path="/staff/:slug" element={<StaffConsole />} />
          <Route path="/board/:slug" element={<Board />} />
          <Route path="/admin" element={<StaffLogin role="ADMIN" />} />
          <Route path="/admin/:slug" element={<Admin />} />
          <Route path="/signup" element={<Auth mode="signup" />} />
          <Route path="/signin" element={<Auth mode="signin" />} />
          <Route path="/account" element={<Account />} />
          <Route path="/tour" element={<Tour />} />
          <Route path="/create" element={<Create />} />
          <Route path="/created/:slug" element={<Created />} />
          <Route path="/op/:slug" element={<Operator />} />
          <Route path="/op/:slug/:section" element={<Operator />} />
          <Route path="/help" element={<Help />} />
          <Route path="/guide" element={<Guide />} />
          <Route path="/guide/:slug" element={<Guide />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
      <ToastHost />
    </>
  );
}
