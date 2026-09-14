import React from 'react';
import { Routes, Route } from 'react-router-dom';
import PrivateRoute from './PrivateRoute';

// Placeholder components
const Login = () => <div className="p-4">Login Page</div>;
const Register = () => <div className="p-4">Register Page</div>;
const Dashboard = () => <div className="p-4">Dashboard</div>;
const Meeting = () => <div className="p-4">Meeting Details</div>;

const AppRoutes = () => {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
      <Route path="/meeting/:id" element={<PrivateRoute><Meeting /></PrivateRoute>} />
    </Routes>
  );
};

export default AppRoutes;
