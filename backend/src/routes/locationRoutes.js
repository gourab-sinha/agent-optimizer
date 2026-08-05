import express from 'express';
import locationService from '../services/locationService.js';

const router = express.Router();

/**
 * Location Routes
 * HTTP endpoints for location management
 */

/**
 * @route   POST /api/locations
 * @desc    Create a new location
 * @access  Private
 */
router.post('/', async (req, res) => {
  try {
    const location = await locationService.createLocation(req.body);
    res.status(201).json({
      success: true,
      data: location
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/locations
 * @desc    List all locations
 * @access  Private
 */
router.get('/', async (req, res) => {
  try {
    const { limit = 50, offset = 0, includeDeleted = false } = req.query;

    const locations = await locationService.listLocations({
      limit: parseInt(limit),
      offset: parseInt(offset),
      includeDeleted: includeDeleted === 'true'
    });

    res.json({
      success: true,
      data: locations,
      count: locations.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/locations/:id
 * @desc    Get location by ID
 * @access  Private
 */
router.get('/:id', async (req, res) => {
  try {
    const location = await locationService.getLocationById(req.params.id);
    res.json({
      success: true,
      data: location
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/locations/:id/tokens
 * @desc    Get location tokens (decrypted)
 * @access  Private
 */
router.get('/:id/tokens', async (req, res) => {
  try {
    const tokens = await locationService.getLocationTokens(req.params.id);
    res.json({
      success: true,
      data: tokens
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   PUT /api/locations/:id
 * @desc    Update location
 * @access  Private
 */
router.put('/:id', async (req, res) => {
  try {
    const location = await locationService.updateLocation(req.params.id, req.body);
    res.json({
      success: true,
      data: location
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   PUT /api/locations/:id/tokens
 * @desc    Update location tokens
 * @access  Private
 */
router.put('/:id/tokens', async (req, res) => {
  try {
    const location = await locationService.updateLocationTokens(req.params.id, req.body);
    res.json({
      success: true,
      data: location
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   DELETE /api/locations/:id
 * @desc    Soft delete location
 * @access  Private
 */
router.delete('/:id', async (req, res) => {
  try {
    const location = await locationService.deleteLocation(req.params.id);
    res.json({
      success: true,
      data: location,
      message: 'Location deleted successfully'
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
