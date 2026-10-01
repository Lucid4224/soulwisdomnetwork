// 'producer' can use the Podcast Studio; 'admin' can also manage members.
export type UserRole = 'admin' | 'producer' | 'user';

// A member as the admin console lists them (GET /api/admin/users). The email comes from
// Firebase Auth, never from the profile, which every member can read.
export interface Member {
    uid: string;
    displayName: string | null;
    email: string | null;
    role: UserRole;
    banned: boolean;
}

export interface UserProfile {
    uid: string;
    displayName: string | null;
    photoURL: string | null;
    role: UserRole;
    bio?: string;
    banned?: boolean;    // set only by an admin (app/api/admin/users/ban)
    createdAt: any; // Firestore Timestamp
}
