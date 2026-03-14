export type UserRole = "admin" | "manager" | "planner" | "viewer";

export type Profile = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  is_active: boolean;
};

