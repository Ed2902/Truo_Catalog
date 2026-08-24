const path = require('path')
const { randomUUID } = require('crypto')
const dotenv = require('dotenv')
const { PrismaClient } = require('@prisma/client')

dotenv.config({ path: path.join(__dirname, '..', '.env') })

const prisma = new PrismaClient()

const TAXONOMY = [
  {
    name: 'Moda, zapatos y accesorios',
    slug: 'ropa',
    children: [
      {
        name: 'Mujer',
        slug: 'mujer',
        children: [
          { name: 'Camisetas y tops', slug: 'camisetas-tops' },
          { name: 'Blusas y camisas', slug: 'blusas-camisas' },
          { name: 'Vestidos y enterizos', slug: 'vestidos-enterizos' },
          { name: 'Jeans y pantalones', slug: 'jeans-pantalones' },
          { name: 'Faldas y shorts', slug: 'faldas-shorts' },
          { name: 'Chaquetas y abrigos', slug: 'chaquetas-abrigos' },
          { name: 'Ropa deportiva', slug: 'ropa-deportiva' },
          { name: 'Ropa interior y pijamas', slug: 'ropa-interior-pijamas' },
          { name: 'Maternidad', slug: 'maternidad' },
        ],
      },
      {
        name: 'Hombre',
        slug: 'hombre',
        children: [
          { name: 'Camisetas', slug: 'camisetas' },
          { name: 'Camisas y polos', slug: 'camisas-polos' },
          { name: 'Jeans y pantalones', slug: 'jeans-pantalones' },
          { name: 'Bermudas y shorts', slug: 'bermudas-shorts' },
          { name: 'Chaquetas y abrigos', slug: 'chaquetas-abrigos' },
          { name: 'Formal y trajes', slug: 'formal-trajes' },
          { name: 'Ropa deportiva', slug: 'ropa-deportiva' },
          { name: 'Ropa interior y pijamas', slug: 'ropa-interior-pijamas' },
        ],
      },
      {
        name: 'Ninos y ninas',
        slug: 'ninos-ninas',
        children: [
          { name: 'Bebe', slug: 'bebe' },
          { name: 'Nina', slug: 'nina' },
          { name: 'Nino', slug: 'nino' },
          { name: 'Escolar', slug: 'escolar' },
          { name: 'Pijamas y hogar', slug: 'pijamas-hogar' },
        ],
      },
      {
        name: 'Zapatos y calzado',
        slug: 'zapatos-calzado',
        children: [
          { name: 'Tenis', slug: 'tenis' },
          { name: 'Botas y botines', slug: 'botas-botines' },
          { name: 'Zapatos casuales', slug: 'zapatos-casuales' },
          { name: 'Tacones y plataforma', slug: 'tacones-plataforma' },
          { name: 'Sandalias y flats', slug: 'sandalias-flats' },
          { name: 'Formal', slug: 'formal' },
          { name: 'Deportivo', slug: 'deportivo' },
          { name: 'Infantil', slug: 'infantil' },
        ],
      },
      {
        name: 'Bolsos y accesorios',
        slug: 'bolsos-accesorios',
        children: [
          { name: 'Bolsos y mochilas', slug: 'bolsos-mochilas' },
          { name: 'Gafas', slug: 'gafas' },
          { name: 'Cinturones y billeteras', slug: 'cinturones-billeteras' },
          { name: 'Gorras, sombreros y bufandas', slug: 'gorras-sombreros-bufandas' },
        ],
      },
      {
        name: 'Joyeria y relojeria',
        slug: 'joyeria-relojeria',
        children: [
          { name: 'Joyeria fina', slug: 'joyeria-fina' },
          { name: 'Bisuteria', slug: 'bisuteria' },
          { name: 'Relojes', slug: 'relojes' },
          { name: 'Piercings y accesorios', slug: 'piercings-accesorios' },
        ],
      },
    ],
  },
  {
    name: 'Tecnologia',
    slug: 'tecnologia',
    children: [
      {
        name: 'Celulares y tablets',
        slug: 'celulares-tablets',
        children: [
          { name: 'Smartphones', slug: 'smartphones' },
          { name: 'Tablets', slug: 'tablets' },
          { name: 'Telefonos basicos', slug: 'telefonos-basicos' },
          { name: 'Smartwatches', slug: 'smartwatches' },
          { name: 'Fundas y protectores', slug: 'fundas-protectores' },
          { name: 'Cargadores y cables', slug: 'cargadores-cables' },
          { name: 'Power banks y baterias', slug: 'power-banks-baterias' },
          { name: 'Repuestos y pantallas', slug: 'repuestos-pantallas' },
        ],
      },
      {
        name: 'Computadores',
        slug: 'computadores',
        children: [
          { name: 'Portatiles', slug: 'portatiles' },
          { name: 'Escritorio y all in one', slug: 'escritorio-all-in-one' },
          { name: 'Monitores', slug: 'monitores' },
          { name: 'Teclados y mouse', slug: 'teclados-mouse' },
          { name: 'Impresoras y escaneres', slug: 'impresoras-escaneres' },
          { name: 'Componentes', slug: 'componentes' },
          { name: 'Almacenamiento', slug: 'almacenamiento' },
          { name: 'Accesorios para laptop', slug: 'accesorios-laptop' },
        ],
      },
      {
        name: 'Audio',
        slug: 'audio',
        children: [
          { name: 'Audifonos', slug: 'audifonos' },
          { name: 'Parlantes', slug: 'parlantes' },
          { name: 'Barras de sonido', slug: 'barras-sonido' },
          { name: 'Microfonos', slug: 'microfonos' },
          { name: 'Audio profesional', slug: 'audio-profesional' },
        ],
      },
      {
        name: 'TV y video',
        slug: 'tv-video',
        children: [
          { name: 'Televisores', slug: 'televisores' },
          { name: 'Proyectores', slug: 'proyectores' },
          { name: 'Streaming y decodificadores', slug: 'streaming-decodificadores' },
          { name: 'Camaras fotograficas', slug: 'camaras-fotograficas' },
          { name: 'Drones y accion', slug: 'drones-accion' },
        ],
      },
      {
        name: 'Redes y oficina',
        slug: 'redes-oficina',
        children: [
          { name: 'Routers y repetidores', slug: 'routers-repetidores' },
          { name: 'Switches y puntos de acceso', slug: 'switches-puntos-acceso' },
          { name: 'Webcams y videoconferencia', slug: 'webcams-videoconferencia' },
          { name: 'UPS y reguladores', slug: 'ups-reguladores' },
          { name: 'Lectores y adaptadores', slug: 'lectores-adaptadores' },
        ],
      },
      {
        name: 'Smart home y wearables',
        slug: 'smart-home-wearables',
        children: [
          { name: 'Bandas y relojes inteligentes', slug: 'bandas-relojes-inteligentes' },
          { name: 'Domotica', slug: 'domotica' },
          { name: 'Seguridad inteligente', slug: 'seguridad-inteligente' },
          { name: 'Asistentes y hubs', slug: 'asistentes-hubs' },
        ],
      },
    ],
  },
  {
    name: 'Videojuegos y gaming',
    slug: 'videojuegos-gaming',
    children: [
      {
        name: 'Consolas',
        slug: 'consolas',
        children: [
          { name: 'PlayStation', slug: 'playstation' },
          { name: 'Xbox', slug: 'xbox' },
          { name: 'Nintendo', slug: 'nintendo' },
          { name: 'Portatiles retro', slug: 'portatiles-retro' },
        ],
      },
      {
        name: 'Juegos',
        slug: 'juegos',
        children: [
          { name: 'Juegos fisicos', slug: 'juegos-fisicos' },
          { name: 'Colecciones y ediciones', slug: 'colecciones-ediciones' },
          { name: 'Tarjetas y gift cards', slug: 'tarjetas-gift-cards' },
        ],
      },
      {
        name: 'Accesorios gaming',
        slug: 'accesorios-gaming',
        children: [
          { name: 'Controles', slug: 'controles' },
          { name: 'Headsets gaming', slug: 'headsets-gaming' },
          { name: 'Sillas y escritorios gaming', slug: 'sillas-escritorios-gaming' },
          { name: 'Capturadoras y streaming', slug: 'capturadoras-streaming' },
        ],
      },
      {
        name: 'PC gaming',
        slug: 'pc-gaming',
        children: [
          { name: 'PC armados', slug: 'pc-armados' },
          { name: 'Tarjetas graficas', slug: 'tarjetas-graficas' },
          { name: 'Procesadores y boards', slug: 'procesadores-boards' },
          { name: 'Refrigeracion y fuentes', slug: 'refrigeracion-fuentes' },
        ],
      },
    ],
  },
  {
    name: 'Hogar y decoracion',
    slug: 'hogar-decoracion',
    children: [
      { name: 'Cocina', slug: 'cocina' },
      { name: 'Comedor', slug: 'comedor' },
      { name: 'Bano', slug: 'bano' },
      { name: 'Dormitorio', slug: 'dormitorio' },
      { name: 'Decoracion', slug: 'decoracion' },
      { name: 'Organizacion', slug: 'organizacion' },
      { name: 'Iluminacion', slug: 'iluminacion' },
      { name: 'Limpieza del hogar', slug: 'limpieza-hogar' },
    ],
  },
  {
    name: 'Muebles',
    slug: 'muebles',
    children: [
      { name: 'Sala', slug: 'sala' },
      { name: 'Comedor', slug: 'comedor' },
      { name: 'Dormitorio', slug: 'dormitorio' },
      { name: 'Oficina', slug: 'oficina' },
      { name: 'Exterior', slug: 'exterior' },
      { name: 'Infantiles', slug: 'infantiles' },
      { name: 'Almacenamiento', slug: 'almacenamiento' },
    ],
  },
  {
    name: 'Electrodomesticos',
    slug: 'electrodomesticos',
    children: [
      { name: 'Refrigeracion', slug: 'refrigeracion' },
      { name: 'Lavado y secado', slug: 'lavado-secado' },
      { name: 'Cocina electrica', slug: 'cocina-electrica' },
      { name: 'Pequenos electrodomesticos', slug: 'pequenos-electrodomesticos' },
      { name: 'Climatizacion', slug: 'climatizacion' },
      { name: 'Aspirado y limpieza', slug: 'aspirado-limpieza' },
    ],
  },
  {
    name: 'Perfumeria, cosmeticos y cuidado personal',
    slug: 'perfumeria-cosmeticos-cuidado-personal',
    children: [
      { name: 'Cosmeticos y maquillaje', slug: 'cosmeticos-maquillaje' },
      { name: 'Perfumeria', slug: 'perfumeria' },
      { name: 'Cuidado facial', slug: 'cuidado-facial' },
      { name: 'Cuidado corporal', slug: 'cuidado-corporal' },
      { name: 'Cabello', slug: 'cabello' },
      { name: 'Unas y manicure', slug: 'unas-manicure' },
      { name: 'Herramientas de belleza', slug: 'herramientas-belleza' },
      { name: 'Barberia y afeitado', slug: 'barberia-afeitado' },
    ],
  },
  {
    name: 'Bebes y ninos',
    slug: 'bebes-ninos',
    children: [
      { name: 'Ropa de bebe', slug: 'ropa-bebe' },
      { name: 'Paseo y transporte', slug: 'paseo-transporte' },
      { name: 'Habitacion del bebe', slug: 'habitacion-bebe' },
      { name: 'Lactancia y alimentacion', slug: 'lactancia-alimentacion' },
      { name: 'Higiene y cuidado', slug: 'higiene-cuidado' },
      { name: 'Juguetes y desarrollo', slug: 'juguetes-desarrollo' },
      { name: 'Seguridad infantil', slug: 'seguridad-infantil' },
    ],
  },
  {
    name: 'Deportes y aire libre',
    slug: 'deportes-aire-libre',
    children: [
      {
        name: 'Fitness',
        slug: 'fitness',
        children: [
          { name: 'Pesas y mancuernas', slug: 'pesas-mancuernas' },
          { name: 'Colchonetas y yoga', slug: 'colchonetas-yoga' },
          { name: 'Bandas y funcional', slug: 'bandas-funcional' },
          { name: 'Maquinas y cardio', slug: 'maquinas-cardio' },
        ],
      },
      {
        name: 'Ciclismo',
        slug: 'ciclismo',
        children: [
          { name: 'Bicicletas', slug: 'bicicletas' },
          { name: 'Cascos', slug: 'cascos' },
          { name: 'Repuestos y accesorios', slug: 'repuestos-accesorios' },
        ],
      },
      { name: 'Futbol', slug: 'futbol' },
      { name: 'Running', slug: 'running' },
      { name: 'Camping y senderismo', slug: 'camping-senderismo' },
      { name: 'Deportes acuaticos', slug: 'deportes-acuaticos' },
      { name: 'Patines y scooters', slug: 'patines-scooters' },
    ],
  },
  {
    name: 'Libros, papeleria y hobbies',
    slug: 'libros-papeleria-hobbies',
    children: [
      { name: 'Libros', slug: 'libros' },
      { name: 'Papeleria escolar', slug: 'papeleria-escolar' },
      { name: 'Papeleria de oficina', slug: 'papeleria-oficina' },
      { name: 'Manualidades', slug: 'manualidades' },
      { name: 'Fotografia', slug: 'fotografia' },
      { name: 'Modelismo', slug: 'modelismo' },
      { name: 'Arte plastico', slug: 'arte-plastico' },
    ],
  },
  {
    name: 'Mascotas',
    slug: 'mascotas',
    children: [
      {
        name: 'Perros',
        slug: 'perros',
        children: [
          { name: 'Alimento', slug: 'alimento' },
          { name: 'Camas y casas', slug: 'camas-casas' },
          { name: 'Collares y correas', slug: 'collares-correas' },
          { name: 'Juguetes', slug: 'juguetes' },
          { name: 'Higiene', slug: 'higiene' },
        ],
      },
      {
        name: 'Gatos',
        slug: 'gatos',
        children: [
          { name: 'Alimento', slug: 'alimento' },
          { name: 'Areneros', slug: 'areneros' },
          { name: 'Rascadores', slug: 'rascadores' },
          { name: 'Camas y transporte', slug: 'camas-transporte' },
          { name: 'Higiene', slug: 'higiene' },
        ],
      },
      { name: 'Aves', slug: 'aves' },
      { name: 'Peces', slug: 'peces' },
      { name: 'Roedores y pequenos animales', slug: 'roedores-pequenos-animales' },
      { name: 'Veterinaria y salud', slug: 'veterinaria-salud' },
    ],
  },
  {
    name: 'Herramientas y construccion',
    slug: 'herramientas-construccion',
    children: [
      {
        name: 'Herramientas manuales',
        slug: 'herramientas-manuales',
        children: [
          { name: 'Destornilladores', slug: 'destornilladores' },
          { name: 'Llaves y copas', slug: 'llaves-copas' },
          { name: 'Martillos y alicates', slug: 'martillos-alicates' },
        ],
      },
      {
        name: 'Herramientas electricas',
        slug: 'herramientas-electricas',
        children: [
          { name: 'Taladros', slug: 'taladros' },
          { name: 'Pulidoras', slug: 'pulidoras' },
          { name: 'Sierras', slug: 'sierras' },
          { name: 'Compresores', slug: 'compresores' },
        ],
      },
      { name: 'Pintura y acabados', slug: 'pintura-acabados' },
      { name: 'Electricidad', slug: 'electricidad' },
      { name: 'Plomeria', slug: 'plomeria' },
      { name: 'Seguridad industrial', slug: 'seguridad-industrial' },
      { name: 'Materiales de obra', slug: 'materiales-obra' },
    ],
  },
  {
    name: 'Automotriz y motos',
    slug: 'automotriz-motos',
    children: [
      { name: 'Repuestos para carro', slug: 'repuestos-carro' },
      { name: 'Accesorios para carro', slug: 'accesorios-carro' },
      { name: 'Audio y multimedia', slug: 'audio-multimedia' },
      { name: 'Llantas y rines', slug: 'llantas-rines' },
      { name: 'Repuestos para moto', slug: 'repuestos-moto' },
      { name: 'Cascos y proteccion', slug: 'cascos-proteccion' },
      { name: 'Herramientas y mantenimiento', slug: 'herramientas-mantenimiento' },
    ],
  },
  {
    name: 'Arte, musica y coleccionables',
    slug: 'arte-musica-coleccionables',
    children: [
      { name: 'Cuadros y decoracion artistica', slug: 'cuadros-decoracion-artistica' },
      { name: 'Instrumentos de cuerda', slug: 'instrumentos-cuerda' },
      { name: 'Teclados y percusion', slug: 'teclados-percusion' },
      { name: 'Audio para escenario', slug: 'audio-escenario' },
      { name: 'Figuras y merchandising', slug: 'figuras-merchandising' },
      { name: 'Monedas y billetes', slug: 'monedas-billetes' },
      { name: 'Antiguedades', slug: 'antiguedades' },
      { name: 'Cartas y comics', slug: 'cartas-comics' },
    ],
  },
  {
    name: 'Salud y bienestar',
    slug: 'salud-bienestar',
    children: [
      { name: 'Medicamentos OTC', slug: 'medicamentos-otc' },
      { name: 'Botiquin y primeros auxilios', slug: 'botiquin-primeros-auxilios' },
      { name: 'Vitaminas y suplementos', slug: 'vitaminas-suplementos' },
      { name: 'Movilidad asistida', slug: 'movilidad-asistida' },
      { name: 'Fisioterapia', slug: 'fisioterapia' },
      { name: 'Masaje y relajacion', slug: 'masaje-relajacion' },
      { name: 'Monitoreo de salud', slug: 'monitoreo-salud' },
      { name: 'Cuidado personal medico', slug: 'cuidado-personal-medico' },
    ],
  },
  {
    name: 'Jardin y exterior',
    slug: 'jardin-exterior',
    children: [
      { name: 'Plantas', slug: 'plantas' },
      { name: 'Macetas y soportes', slug: 'macetas-soportes' },
      { name: 'Herramientas de jardin', slug: 'herramientas-jardin' },
      { name: 'Parrillas y BBQ', slug: 'parrillas-bbq' },
      { name: 'Patio y terraza', slug: 'patio-terraza' },
      { name: 'Riego', slug: 'riego' },
    ],
  },
  {
    name: 'Oficina y negocio',
    slug: 'oficina-negocio',
    children: [
      { name: 'Escritorios y estaciones', slug: 'escritorios-estaciones' },
      { name: 'Sillas de oficina', slug: 'sillas-oficina' },
      { name: 'Almacenamiento y archivo', slug: 'almacenamiento-archivo' },
      { name: 'Punto de venta', slug: 'punto-venta' },
      { name: 'Equipos para negocio', slug: 'equipos-negocio' },
      { name: 'Insumos de oficina', slug: 'insumos-oficina' },
    ],
  },
  {
    name: 'Mercado y despensa',
    slug: 'mercado-despensa',
    children: [
      {
        name: 'Despensa',
        slug: 'despensa',
        children: [
          { name: 'Granos y cereales', slug: 'granos-cereales' },
          { name: 'Pastas y arroces', slug: 'pastas-arroces' },
          { name: 'Aceites y salsas', slug: 'aceites-salsas' },
          { name: 'Enlatados y conservas', slug: 'enlatados-conservas' },
        ],
      },
      {
        name: 'Snacks y dulces',
        slug: 'snacks-dulces',
        children: [
          { name: 'Galletas y ponques', slug: 'galletas-ponques' },
          { name: 'Chocolates y dulces', slug: 'chocolates-dulces' },
          { name: 'Snacks salados', slug: 'snacks-salados' },
        ],
      },
      {
        name: 'Bebidas',
        slug: 'bebidas',
        children: [
          { name: 'Agua y gaseosas', slug: 'agua-gaseosas' },
          { name: 'Jugos y te', slug: 'jugos-te' },
          { name: 'Cafe', slug: 'cafe' },
          { name: 'Bebidas energeticas', slug: 'bebidas-energeticas' },
        ],
      },
      {
        name: 'Frescos y refrigerados',
        slug: 'frescos-refrigerados',
        children: [
          { name: 'Frutas y verduras', slug: 'frutas-verduras' },
          { name: 'Lacteos y huevos', slug: 'lacteos-huevos' },
          { name: 'Panaderia y reposteria', slug: 'panaderia-reposteria' },
          { name: 'Carnes y congelados', slug: 'carnes-congelados' },
        ],
      },
      {
        name: 'Aseo del hogar',
        slug: 'aseo-hogar',
        children: [
          { name: 'Detergentes y lavado', slug: 'detergentes-lavado' },
          { name: 'Desinfeccion y limpieza', slug: 'desinfeccion-limpieza' },
          { name: 'Papel hogar', slug: 'papel-hogar' },
        ],
      },
      {
        name: 'Cuidado personal diario',
        slug: 'cuidado-personal-diario',
        children: [
          { name: 'Jabones y shampoo', slug: 'jabones-shampoo' },
          { name: 'Desodorantes', slug: 'desodorantes' },
          { name: 'Cuidado oral', slug: 'cuidado-oral' },
        ],
      },
      { name: 'Gourmet y especiales', slug: 'gourmet-especiales' },
    ],
  },
  {
    name: 'Servicios',
    slug: 'servicios',
    children: [
      {
        name: 'Arreglos y reparaciones',
        slug: 'arreglos-reparaciones',
        children: [
          { name: 'Limpieza', slug: 'limpieza' },
          { name: 'Plomeria', slug: 'plomeria' },
          { name: 'Electricidad', slug: 'electricidad' },
          { name: 'Pintura', slug: 'pintura' },
          { name: 'Cerrajeria', slug: 'cerrajeria' },
          { name: 'Carpinteria', slug: 'carpinteria' },
          { name: 'Arreglos de electrodomesticos', slug: 'arreglos-electrodomesticos' },
          { name: 'Mudanza y trasteos', slug: 'mudanza-trasteos' },
        ],
      },
      {
        name: 'Tecnologia',
        slug: 'tecnologia',
        children: [
          { name: 'Reparacion de celulares', slug: 'reparacion-celulares' },
          { name: 'Reparacion de computadores', slug: 'reparacion-computadores' },
          { name: 'Soporte tecnico', slug: 'soporte-tecnico' },
          { name: 'Diseno y desarrollo', slug: 'diseno-desarrollo' },
        ],
      },
      {
        name: 'Belleza y bienestar',
        slug: 'belleza-bienestar',
        children: [
          { name: 'Peluqueria', slug: 'peluqueria' },
          { name: 'Manicure y pedicure', slug: 'manicure-pedicure' },
          { name: 'Maquillaje', slug: 'maquillaje' },
          { name: 'Spa y masajes', slug: 'spa-masajes' },
          { name: 'Entrenamiento personal', slug: 'entrenamiento-personal' },
        ],
      },
      {
        name: 'Educacion y clases',
        slug: 'educacion-clases',
        children: [
          { name: 'Idiomas', slug: 'idiomas' },
          { name: 'Musica', slug: 'musica' },
          { name: 'Refuerzo escolar', slug: 'refuerzo-escolar' },
          { name: 'Cursos digitales', slug: 'cursos-digitales' },
        ],
      },
      {
        name: 'Profesionales',
        slug: 'profesionales',
        children: [
          { name: 'Diseno grafico', slug: 'diseno-grafico' },
          { name: 'Marketing y contenido', slug: 'marketing-contenido' },
          { name: 'Contabilidad', slug: 'contabilidad' },
          { name: 'Asesoria empresarial', slug: 'asesoria-empresarial' },
        ],
      },
      {
        name: 'Transporte y mensajeria',
        slug: 'transporte-mensajeria',
        children: [
          { name: 'Mensajeria urbana', slug: 'mensajeria-urbana' },
          { name: 'Fletes', slug: 'fletes' },
          { name: 'Conductor por horas', slug: 'conductor-por-horas' },
        ],
      },
      {
        name: 'Mascotas',
        slug: 'mascotas',
        children: [
          { name: 'Bano y peluqueria', slug: 'bano-peluqueria' },
          { name: 'Paseo', slug: 'paseo' },
          { name: 'Guarderia', slug: 'guarderia' },
          { name: 'Entrenamiento', slug: 'entrenamiento' },
        ],
      },
    ],
  },
  {
    name: 'Eventos y alquileres',
    slug: 'eventos-alquileres',
    children: [
      { name: 'Decoracion y mobiliario', slug: 'decoracion-mobiliario' },
      { name: 'Audio e iluminacion', slug: 'audio-iluminacion' },
      { name: 'Fotografia y video', slug: 'fotografia-video' },
      { name: 'Catering', slug: 'catering' },
      { name: 'Vestidos y trajes en alquiler', slug: 'vestidos-trajes-alquiler' },
      { name: 'Carpas y exteriores', slug: 'carpas-exteriores' },
    ],
  },
  {
    name: 'Agro y campo',
    slug: 'agro-campo',
    children: [
      { name: 'Insumos agricolas', slug: 'insumos-agricolas' },
      { name: 'Herramientas rurales', slug: 'herramientas-rurales' },
      { name: 'Semillas y vivero', slug: 'semillas-vivero' },
      { name: 'Equipos de riego', slug: 'equipos-riego' },
      { name: 'Alimentos para granja', slug: 'alimentos-granja' },
    ],
  },
]

function flattenTaxonomy(nodes, parentPath = null, depth = 0) {
  const result = []

  for (const node of nodes) {
    const pathValue = parentPath ? `${parentPath}/${node.slug}` : node.slug
    result.push({
      name: node.name,
      slug: node.slug,
      parentPath,
      path: pathValue,
      depth,
    })

    if (node.children?.length) {
      result.push(...flattenTaxonomy(node.children, pathValue, depth + 1))
    }
  }

  return result
}

async function syncCategories() {
  const desiredEntries = flattenTaxonomy(TAXONOMY).sort((a, b) => {
    if (a.depth !== b.depth) {
      return a.depth - b.depth
    }

    return a.path.localeCompare(b.path)
  })

  const desiredPaths = new Set(desiredEntries.map(entry => entry.path))
  const itemCounts = new Map()
  const itemCountRows = await prisma.$queryRawUnsafe(`
    SELECT "categoryId", COUNT(id)::int AS count
    FROM catalog."CatalogItem"
    GROUP BY "categoryId";
  `)

  for (const row of itemCountRows) {
    itemCounts.set(row.categoryId, row.count)
  }

  const allCategories = await prisma.catalogCategory.findMany()
  const categoryById = new Map(allCategories.map(category => [category.id, category]))
  const categoryByPath = new Map(allCategories.map(category => [category.path, category]))
  const syncedByPath = new Map()

  let created = 0
  let updated = 0

  for (const entry of desiredEntries) {
    const parent = entry.parentPath ? syncedByPath.get(entry.parentPath) ?? null : null
    const parentId = parent?.id ?? null
    let existing = categoryByPath.get(entry.path) ?? null

    if (!existing) {
      existing =
        allCategories.find(category => {
          return category.slug === entry.slug && category.parentId === parentId
        }) ?? null
    }

    if (existing) {
      const next = await prisma.catalogCategory.update({
        where: { id: existing.id },
        data: {
          name: entry.name,
          slug: entry.slug,
          parentId,
          path: entry.path,
          depth: entry.depth,
          isActive: true,
          updatedAt: new Date(),
        },
      })
      updated += 1
      syncedByPath.set(entry.path, next)
      categoryByPath.set(entry.path, next)
      categoryById.set(next.id, next)
      continue
    }

    const next = await prisma.catalogCategory.create({
      data: {
        id: randomUUID(),
        name: entry.name,
        slug: entry.slug,
        parentId,
        path: entry.path,
        depth: entry.depth,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    })
    created += 1
    syncedByPath.set(entry.path, next)
    categoryByPath.set(entry.path, next)
    categoryById.set(next.id, next)
  }

  const categoriesAfterUpsert = await prisma.catalogCategory.findMany({
    orderBy: [{ depth: 'desc' }, { path: 'asc' }],
  })

  let deleted = 0
  const preservedInUse = []

  for (const category of categoriesAfterUpsert) {
    if (desiredPaths.has(category.path)) {
      continue
    }

    const attachedItems = itemCounts.get(category.id) ?? 0
    if (attachedItems > 0) {
      preservedInUse.push({
        id: category.id,
        name: category.name,
        path: category.path,
        items: attachedItems,
      })
      continue
    }

    await prisma.catalogCategory.delete({
      where: { id: category.id },
    })
    deleted += 1
  }

  const finalCount = await prisma.catalogCategory.count()
  const rootCount = await prisma.catalogCategory.count({
    where: { depth: 0 },
  })

  const sampleRoots = await prisma.catalogCategory.findMany({
    where: { depth: 0 },
    orderBy: { name: 'asc' },
    take: 12,
    select: { id: true, name: true, path: true },
  })

  return {
    desired: desiredEntries.length,
    created,
    updated,
    deleted,
    preservedInUse,
    finalCount,
    rootCount,
    sampleRoots,
  }
}

async function main() {
  const result = await syncCategories()
  console.log(JSON.stringify(result, null, 2))
}

main()
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
