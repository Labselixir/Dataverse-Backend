// MongoDB initialization script
db = db.getSiblingDB('dataverse');

db.createUser({
  user: 'dataverse',
  pwd: 'dataverse123',
  roles: [
    {
      role: 'readWrite',
      db: 'dataverse'
    }
  ]
});

// Create indexes
db.users.createIndex({ email: 1 }, { unique: true });
db.projects.createIndex({ organizationId: 1, createdAt: -1 });
db.projects.createIndex({ name: 'text' });
db.chathistories.createIndex({ projectId: 1, createdAt: -1 });
db.chathistories.createIndex({ createdAt: 1 }, { expireAfterSeconds: 7776000 });

print('Database initialized successfully');