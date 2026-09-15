import React, { createContext, useMemo, useState } from 'react';

export const AuthContext = createContext(null);

const mockUser = {
  id: 'mock-user',
  name: 'SmartRec User',
  email: 'user@smartrec.local',
};

export const AuthProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [registeredUser, setRegisteredUser] = useState(null);

  const login = async (credentials) => {
    setUser({
      ...mockUser,
      email: credentials.emailOrPhone,
    });
    setIsAuthenticated(true);
    return true;
  };

  const register = async (profile) => {
    setRegisteredUser({
      ...mockUser,
      name: profile.fullName,
      email: profile.email,
    });
    return true;
  };

  const logout = () => {
    setUser(null);
    setIsAuthenticated(false);
  };

  const value = useMemo(() => ({
    isAuthenticated,
    user,
    registeredUser,
    login,
    register,
    logout,
  }), [isAuthenticated, user, registeredUser]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
