const jwt = require('jsonwebtoken');

function generateToken(userId, res) {
  if (!process.env.JWT_SECRET) {
    console.error('JWT_SECRET is not set!');
    throw new Error('Missing JWT_SECRET');
  }

  const token = jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });

  res.cookie("jwt", token, {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV !== "development",
  });

  return token;
}

module.exports = { generateToken };