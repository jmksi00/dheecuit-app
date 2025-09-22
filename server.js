const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Middleware
app.use(cors());
app.use(express.json());

// Create tables on startup
async function createTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS recipes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        title VARCHAR(200) NOT NULL,
        ingredients TEXT NOT NULL,
        instructions TEXT NOT NULL,
        prep_time INTEGER,
        cook_time INTEGER,
        servings INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('Database tables created successfully');
  } catch (err) {
    console.error('Error creating tables:', err);
  }
}

// Authentication middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
}

// Basic Routes
app.get('/', (req, res) => {
  res.json({ message: 'DheeCuit API is running!' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Test database connection
app.get('/test-db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ 
      message: 'Database connected!', 
      timestamp: result.rows[0].now 
    });
  } catch (err) {
    res.status(500).json({ error: 'Database connection failed', details: err.message });
  }
});

// USER AUTHENTICATION ENDPOINTS

// Register new user
app.post('/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Validation
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE username = $1 OR email = $2',
      [username, email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Username or email already exists' });
    }

    // Hash password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Create user
    const result = await pool.query(
      'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email, created_at',
      [username, email, passwordHash]
    );

    // Create JWT token
    const token = jwt.sign(
      { userId: result.rows[0].id, username: result.rows[0].username },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      user: result.rows[0],
      token: token
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

// Login user
app.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    // Find user
    const result = await pool.query(
      'SELECT id, username, email, password_hash FROM users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const user = result.rows[0];

    // Check password
    const passwordValid = await bcrypt.compare(password, user.password_hash);
    if (!passwordValid) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Create JWT token
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      message: 'Login successful',
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      },
      token: token
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to login' });
  }
});

// RECIPE ENDPOINTS (Updated with authentication)

// Get all recipes (public)
app.get('/recipes', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.id, r.title, r.ingredients, r.instructions, r.prep_time, r.cook_time, r.servings, r.created_at,
             u.username as author
      FROM recipes r
      LEFT JOIN users u ON r.user_id = u.id
      ORDER BY r.created_at DESC
    `);
    res.json({
      success: true,
      count: result.rows.length,
      recipes: result.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch recipes' });
  }
});

// Get a specific recipe by ID (public)
app.get('/recipes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT r.id, r.title, r.ingredients, r.instructions, r.prep_time, r.cook_time, r.servings, r.created_at,
             u.username as author
      FROM recipes r
      LEFT JOIN users u ON r.user_id = u.id
      WHERE r.id = $1
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Recipe not found' });
    }
    
    res.json({
      success: true,
      recipe: result.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch recipe' });
  }
});

// Create a new recipe (requires authentication)
app.post('/recipes', async (req, res) => {
  try {
    const { title, ingredients, instructions, prep_time, cook_time, servings } = req.body;
    
    // Basic validation
    if (!title || !ingredients || !instructions) {
      return res.status(400).json({ 
        error: 'Title, ingredients, and instructions are required' 
      });
    }
    
    const result = await pool.query(
      'INSERT INTO recipes (user_id, title, ingredients, instructions, prep_time, cook_time, servings) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [null, title, ingredients, instructions, prep_time || null, cook_time || null, servings || null]
    );
    
    res.status(201).json({
      success: true,
      message: 'Recipe created successfully',
      recipe: result.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create recipe' });
  }
});

// Update a recipe (requires authentication and ownership)
app.put('/recipes/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, ingredients, instructions, prep_time, cook_time, servings } = req.body;
    
    // Check if recipe exists and user owns it
    const checkRecipe = await pool.query('SELECT user_id FROM recipes WHERE id = $1', [id]);
    if (checkRecipe.rows.length === 0) {
      return res.status(404).json({ error: 'Recipe not found' });
    }
    
    if (checkRecipe.rows[0].user_id !== req.user.userId) {
      return res.status(403).json({ error: 'You can only update your own recipes' });
    }
    
    const result = await pool.query(
      'UPDATE recipes SET title = $1, ingredients = $2, instructions = $3, prep_time = $4, cook_time = $5, servings = $6 WHERE id = $7 RETURNING *',
      [title, ingredients, instructions, prep_time, cook_time, servings, id]
    );
    
    res.json({
      success: true,
      message: 'Recipe updated successfully',
      recipe: result.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update recipe' });
  }
});

// Delete a recipe (no authentication required for development)
app.delete('/recipes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if recipe exists
    const checkRecipe = await pool.query('SELECT id FROM recipes WHERE id = $1', [id]);
    if (checkRecipe.rows.length === 0) {
      return res.status(404).json({ error: 'Recipe not found' });
    }
    
    await pool.query('DELETE FROM recipes WHERE id = $1', [id]);
    
    res.json({
      success: true,
      message: 'Recipe deleted successfully'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete recipe' });
  }
});

// Get current user's recipes (requires authentication)
app.get('/my-recipes', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, title, ingredients, instructions, prep_time, cook_time, servings, created_at FROM recipes WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.userId]
    );
    
    res.json({
      success: true,
      count: result.rows.length,
      recipes: result.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch your recipes' });
  }
});

// Initialize database and start server
createTables().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});
