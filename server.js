const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

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

// RECIPE ENDPOINTS

// Get all recipes
app.get('/recipes', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, title, ingredients, instructions, prep_time, cook_time, servings, created_at FROM recipes ORDER BY created_at DESC'
    );
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

// Get a specific recipe by ID
app.get('/recipes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT id, title, ingredients, instructions, prep_time, cook_time, servings, created_at FROM recipes WHERE id = $1',
      [id]
    );
    
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

// Create a new recipe
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
      'INSERT INTO recipes (title, ingredients, instructions, prep_time, cook_time, servings) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [title, ingredients, instructions, prep_time || null, cook_time || null, servings || null]
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

// Update a recipe
app.put('/recipes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, ingredients, instructions, prep_time, cook_time, servings } = req.body;
    
    // Check if recipe exists
    const checkRecipe = await pool.query('SELECT id FROM recipes WHERE id = $1', [id]);
    if (checkRecipe.rows.length === 0) {
      return res.status(404).json({ error: 'Recipe not found' });
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

// Delete a recipe
app.delete('/recipes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query('DELETE FROM recipes WHERE id = $1 RETURNING id', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Recipe not found' });
    }
    
    res.json({
      success: true,
      message: 'Recipe deleted successfully'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete recipe' });
  }
});

// Initialize database and start server
createTables().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});
