const express = require('express')
const { getActiveRetreats, getRetreatById } = require('../controllers/retreatController')

const router = express.Router()

// Public endpoints to browse retreats
router.get('/retreats', getActiveRetreats)
router.get('/retreats/:id', getRetreatById)

module.exports = router