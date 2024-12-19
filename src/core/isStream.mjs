export default (obj) => {

  return obj && typeof obj === 'object' && typeof obj.pipe === 'function' && typeof obj.on === 'function';

};
